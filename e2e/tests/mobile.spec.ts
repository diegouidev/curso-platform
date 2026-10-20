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
