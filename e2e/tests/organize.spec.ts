import { expect, test } from "./fixtures";

// 2×2 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMUqKhgYGBgYgADAAvCAQR7n7WcAAAAAElFTkSuQmCC",
  "base64",
);

test("renomeia, oculta e restaura aulas sem mexer no Drive", async ({ page, seed }) => {
  const s = await seed();
  await page.goto(`/courses/${s.course_id}`);
  await page.getByRole("button", { name: "Mais ações do curso" }).click();
  await page.getByRole("menuitem", { name: "Organizar módulos e aulas" }).click();
  await expect(page.getByRole("heading", { name: "Organizar curso" })).toBeVisible();

  await page.getByRole("button", { name: "Mostrar aulas de Módulo 1 - Fundamentos" }).click();
  await page.getByRole("button", { name: "Renomear aula: 01 - Introdução" }).click();
  await page.getByRole("textbox", { name: "Novo título da aula" }).fill("Introdução ao curso");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Renomear aula: Introdução ao curso" })).toBeVisible();

  await page.getByRole("button", { name: "Ocultar aula 10 - Revisão" }).click();
  await expect(page.getByRole("button", { name: "Mostrar aula 10 - Revisão" })).toBeVisible();

  await page.goto(`/courses/${s.course_id}`);
  await expect(page.getByText("1 item oculto.")).toBeVisible();
  await page.getByRole("button", { name: /Módulo 1 - Fundamentos/ }).click();
  await expect(page.getByRole("link", { name: /Introdução ao curso/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /10 - Revisão/ })).toHaveCount(0);

  // Empty title = back to the Drive name.
  await page.getByRole("link", { name: "Gerenciar em Organizar" }).click();
  await page.getByRole("button", { name: "Mostrar aulas de Módulo 1 - Fundamentos" }).click();
  await page.getByRole("button", { name: "Restaurar o nome do Drive: Introdução ao curso" }).click();
  await expect(page.getByRole("button", { name: "Renomear aula: 01 - Introdução" })).toBeVisible();
});

test("reordena módulos pelo teclado e restaura a ordem do Drive", async ({ page, seed }) => {
  const s = await seed();
  await page.goto(`/courses/${s.course_id}/organize`);
  const handles = page.getByRole("button", { name: /^Arrastar módulo / });
  await expect(handles).toHaveCount(3);
  const names = async () =>
    (await handles.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).map(
      (label) => label?.replace("Arrastar módulo ", ""),
    );
  expect(await names()).toEqual(["Geral", "Módulo 1 - Fundamentos", "Módulo 2 - Prática"]);

  await handles.nth(2).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect.poll(names).toEqual(["Geral", "Módulo 2 - Prática", "Módulo 1 - Fundamentos"]);

  // Persisted: the course page follows the new order.
  await page.reload();
  await expect.poll(names).toEqual(["Geral", "Módulo 2 - Prática", "Módulo 1 - Fundamentos"]);

  await page.getByRole("button", { name: "Restaurar ordem do Drive" }).click();
  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  await expect(page.getByText("Ordem do Drive restaurada.")).toBeVisible();
  await expect.poll(names).toEqual(["Geral", "Módulo 1 - Fundamentos", "Módulo 2 - Prática"]);
});

test("edita título, descrição e capa, e arquiva o curso", async ({ page, seed }) => {
  const s = await seed();
  await page.goto(`/courses/${s.course_id}`);
  await page.getByRole("button", { name: "Mais ações do curso" }).click();
  await page.getByRole("menuitem", { name: "Editar título, capa e descrição" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar curso" });

  await dialog.locator('input[type="file"]').setInputFiles({
    name: "capa.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByText("Capa atualizada.")).toBeVisible();
  await dialog.getByLabel("Título").fill("Python do zero");
  await dialog.getByLabel("Descrição").fill("Revisão para a prova.");
  await dialog.getByRole("button", { name: "Salvar" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Python do zero" })).toBeVisible();
  await expect(page.getByText("Revisão para a prova.")).toBeVisible();

  await page.goto("/");
  const card = page.getByRole("link", { name: /Python do zero/ });
  const cover = card.locator("img");
  await expect(cover).toHaveAttribute("src", /^\/api\/media\/thumbnails\//);
  // The <img> loads with the session cookie (no Bearer header).
  expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);

  await card.click();
  await page.getByRole("button", { name: "Mais ações do curso" }).click();
  await page.getByRole("menuitem", { name: "Arquivar curso" }).click();
  await expect(page.getByText("Curso arquivado.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Arquivados (1)")).toBeVisible();
});
