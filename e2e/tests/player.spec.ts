import { expect, lessonUrl, openLesson, player, test } from "./fixtures";

test("abre a aula pela página do curso, com o embed oficial do Drive", async ({ page, seed }) => {
  const s = await seed();

  await page.goto(`/courses/${s.course_id}`);
  await page.getByRole("button", { name: /Módulo 1 - Fundamentos/ }).click();
  await page.getByRole("link", { name: /01 - Introdução/ }).click();

  await expect(page).toHaveURL(lessonUrl(s, "01 - Introdução"));
  await expect(player(page)).toHaveAttribute(
    "src",
    "https://drive.google.com/file/d/e2e-m1-intro-video/preview",
  );
  await expect(page.getByText("Aula 2 de 8")).toBeVisible();
  // The lesson list sits next to the video, never on top of it.
  const overlap = await page.evaluate(() => {
    const aside = document.querySelector("aside")!.getBoundingClientRect();
    const video = document.querySelector('iframe[title^="Vídeo:"]')!.getBoundingClientRect();
    return video.right > aside.left;
  });
  expect(overlap).toBe(false);
});

test("conclui com M, desfaz e navega com N e P", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "01 - Introdução");

  await page.keyboard.press("m");
  await expect(page.getByText("Aula concluída")).toBeVisible();
  const done = page.getByRole("button", { name: "Concluída", exact: true });
  await expect(done).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("button", { name: "Marcar como concluída" })).toBeVisible();

  await page.getByRole("button", { name: "Marcar como concluída" }).click();
  await expect(done).toBeVisible();
  // After completing, "Próxima" becomes the primary action.
  await page.keyboard.press("n");
  await expect(page).toHaveURL(lessonUrl(s, "02 - Variáveis"));
  await expect(page.getByRole("heading", { level: 1, name: "02 - Variáveis" })).toBeVisible();

  await page.keyboard.press("p");
  await expect(page).toHaveURL(lessonUrl(s, "01 - Introdução"));

  // The outline marks the lesson as done and the course progress moved.
  const outline = page.getByRole("navigation", { name: "Aulas do curso" });
  await expect(outline.getByRole("link", { name: /Concluída: 01 - Introdução/ })).toBeVisible();
  await expect(outline.getByText("1/8")).toBeVisible();
});

test("modo foco esconde a lista de aulas (S)", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "02 - Variáveis");
  const outline = page.getByRole("navigation", { name: "Aulas do curso" });

  await expect(outline).toBeVisible();
  await page.keyboard.press("s");
  await expect(outline).toBeHidden();
  await expect(page.getByRole("button", { name: "Mostrar aulas" })).toBeVisible();
  // Remembered across lessons.
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { level: 1, name: "10 - Revisão" })).toBeVisible();
  await expect(outline).toBeHidden();
  await page.getByRole("button", { name: "Mostrar aulas" }).click();
  await expect(outline).toBeVisible();
});

test("anexo abre em visualização embutida", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "02 - Variáveis");

  await page.getByRole("button", { name: /02 - Variáveis.*visualizar/ }).click();
  const dialog = page.getByRole("dialog", { name: "02 - Variáveis" });
  await expect(dialog.locator("iframe")).toHaveAttribute(
    "src",
    "https://drive.google.com/file/d/e2e-m1-vars-pdf-01/preview",
  );
  await expect(dialog.getByRole("link", { name: /Abrir em nova aba/ })).toHaveAttribute(
    "href",
    "https://drive.google.com/file/d/e2e-m1-vars-pdf-01/view",
  );
});

test("sugere concluir depois de 90% da duração com a aba visível", async ({ page, seed }) => {
  const s = await seed();
  await page.clock.install();
  await openLesson(page, s, "01 - Introdução"); // 0:40 → 36 s

  await page.clock.runFor(20_000);
  await expect(page.getByText("Marcar como concluída?")).toBeHidden();
  await page.clock.runFor(20_000);
  await expect(page.getByText("Marcar como concluída?")).toBeVisible();

  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByRole("button", { name: "Concluída", exact: true })).toBeVisible();
});

test("continuar de onde parei no dashboard", async ({ page, seed }) => {
  const s = await seed();
  await page.goto("/");
  const card = page.getByRole("region", { name: "00 - Boas-vindas" });
  await expect(card.getByText("Comece por aqui")).toBeVisible();

  // The "opened" ping (first heartbeat) is what "continue" is based on.
  const opened = page.waitForResponse((r) => r.url().includes("/heartbeat") && r.ok());
  await openLesson(page, s, "02 - Variáveis");
  await opened;
  await page.goto("/");
  const resume = page.getByRole("region", { name: "02 - Variáveis" });
  await expect(resume.getByText("Continuar assistindo")).toBeVisible();
  await resume.getByRole("link", { name: "Continuar" }).click();
  await expect(page).toHaveURL(lessonUrl(s, "02 - Variáveis"));
});

test("F alterna a tela cheia do player e o botão faz o mesmo", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "01 - Introdução");
  const box = player(page).locator("..");
  await expect(box).toHaveAttribute("data-fullscreen", "off");

  await page.keyboard.press("f");
  // Native fullscreen when the browser grants it, the CSS fallback otherwise.
  await expect(box).toHaveAttribute("data-fullscreen", /native|expanded/);
  const viewport = page.viewportSize()!;
  const rect = (await box.boundingBox())!;
  expect(Math.round(rect.width)).toBe(viewport.width);
  expect(Math.round(rect.height)).toBe(viewport.height);

  await page.keyboard.press("f");
  await expect(box).toHaveAttribute("data-fullscreen", "off");

  await page.getByRole("button", { name: "Tela cheia" }).click();
  await expect(box).toHaveAttribute("data-fullscreen", /native|expanded/);
  await page.getByRole("button", { name: "Sair da tela cheia" }).click();
  await expect(box).toHaveAttribute("data-fullscreen", "off");
});
