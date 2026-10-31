import { expect, lessonUrl, test } from "./fixtures";

test("subpastas do módulo viram seções que abrem e fecham", async ({ page, seed }) => {
  const s = await seed();
  await page.goto(`/courses/${s.course_id}`);
  await page.getByRole("button", { name: /Módulo 2 - Prática/ }).click();

  // Videos right in the module folder stay loose; "Extras/" is a section, open while unfinished.
  await expect(page.getByRole("link", { name: /Aula 1/ })).toBeVisible();
  const section = page.getByRole("button", { name: /Seção 01\s*Extras/ });
  const bonus = page.getByRole("link", { name: /Extras - Bônus/ });
  await expect(section).toHaveAttribute("aria-expanded", "true");
  await expect(bonus).toBeVisible();
  await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "false");
  await expect(bonus).toBeHidden();
  await section.click();
  await bonus.click();
  await expect(page).toHaveURL(lessonUrl(s, "Extras - Bônus"));

  // In the player the section shows in the breadcrumb and opens around the current lesson.
  await expect(page.getByRole("navigation", { name: "Você está em" })).toContainText("Extras");
  const outline = page.getByRole("navigation", { name: "Aulas do curso" });
  await expect(outline.getByRole("button", { name: /Extras/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(outline.getByRole("link", { name: /Extras - Bônus/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
