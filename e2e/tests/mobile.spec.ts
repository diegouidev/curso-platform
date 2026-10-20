import { expect, lessonUrl, test } from "./fixtures";

const noHorizontalScroll = () =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth;

test("no celular a lista de aulas vira gaveta e nada transborda", async ({ page, seed }) => {
  const s = await seed();

  for (const url of ["/", `/courses/${s.course_id}`, `/courses/${s.course_id}/organize`, "/settings"]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(noHorizontalScroll), url).toBe(true);
  }

  // Long lesson titles end in an ellipsis inside the list; the duration stays visible.
  await page.goto(`/courses/${s.course_id}`);
  await page.getByRole("button", { name: /Módulo 2 - Prática/ }).click();
  const row = page.getByRole("link", { name: /Aula 3 - Um título bem longo/ });
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByText("2:30")).toBeInViewport();
  const fits = await row.evaluate((link) => {
    const list = link.closest("ul")!.getBoundingClientRect();
    const title = link.querySelector<HTMLElement>(".truncate")!;
    return link.getBoundingClientRect().right <= list.right + 1 && title.scrollWidth > title.clientWidth;
  });
  expect(fits).toBe(true);

  await page.goto(lessonUrl(s, "01 - Introdução"));
  await expect(page.getByRole("heading", { level: 1, name: "01 - Introdução" })).toBeVisible();
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  // No sidebar next to the video on a phone…
  await expect(page.getByRole("navigation", { name: "Aulas do curso" })).toBeHidden();

  // …the "Aulas" button opens it as a drawer, which closes after picking a lesson.
  await page.getByRole("button", { name: "Aulas" }).click();
  const drawer = page.getByRole("dialog", { name: "Aulas do curso" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: /Módulo 2 - Prática/ }).click();
  await drawer.getByRole("link", { name: /Aula 1/ }).click();
  await expect(page).toHaveURL(lessonUrl(s, "Aula 1"));
  await expect(drawer).toBeHidden();
});

test("no celular o player deixa espaço para os controles do Drive", async ({ page, seed }) => {
  const s = await seed();
  await page.goto(lessonUrl(s, "01 - Introdução"));
  const box = page.locator('[data-fullscreen="off"]');
  await expect(box).toBeVisible();

  // The Drive mobile layout needs ~16:9 + 80px; the box gives 16:9 + 6rem (96px).
  const { width, height } = (await box.boundingBox())!;
  expect(height).toBeGreaterThanOrEqual(width * 0.5625 + 90);
  await expect(page.getByRole("button", { name: "Tela cheia" })).toBeInViewport();
});

test("tela cheia sem Fullscreen API (iPhone) expande o player sem recarregar o vídeo", async ({
  page,
  seed,
}) => {
  // iPhone Safari: no element fullscreen.
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false });
  });
  const s = await seed();
  await page.goto(lessonUrl(s, "01 - Introdução"));
  const video = page.locator('iframe[title^="Vídeo:"]');
  await expect(video).toBeVisible();
  await video.evaluate((frame) => frame.setAttribute("data-same-element", "yes"));

  await page.getByRole("button", { name: "Tela cheia" }).click();

  const box = page.locator('[data-fullscreen="expanded"]');
  await expect(box).toBeVisible();
  const viewport = page.viewportSize()!;
  const rect = (await box.boundingBox())!;
  expect(Math.round(rect.x)).toBe(0);
  expect(Math.round(rect.y)).toBe(0);
  expect(Math.round(rect.width)).toBe(viewport.width);
  expect(Math.round(rect.height)).toBe(viewport.height);
  const exit = page.getByRole("button", { name: "Sair da tela cheia" });
  await expect(exit).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  // Same iframe element: the video was not reloaded.
  await expect(video).toHaveAttribute("data-same-element", "yes");

  await exit.click();

  await expect(page.locator('[data-fullscreen="off"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Tela cheia" })).toBeFocused();
  await expect(video).toHaveAttribute("data-same-element", "yes");
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
});
