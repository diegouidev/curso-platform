import { expect, test } from "./fixtures";

test("importa um curso pelo link da pasta do Drive", async ({ page, seed }) => {
  const { course_link } = await seed({ course: false });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nenhum curso ainda" })).toBeVisible();
  await page.getByRole("button", { name: "Importar curso" }).click();

  const dialog = page.getByRole("dialog", { name: "Importar curso do Google Drive" });
  const link = dialog.getByLabel("Link da pasta do curso no Google Drive");
  await link.fill("isso não é um link");
  await dialog.getByRole("button", { name: "Importar curso" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Link inválido");

  await link.fill(course_link);
  await dialog.getByRole("button", { name: "Importar curso" }).click();

  await expect(page).toHaveURL(/\/courses\/\d+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Curso E2E de Python" })).toBeVisible();
  for (const module of ["Geral", "Módulo 1 - Fundamentos", "Módulo 2 - Prática"]) {
    await expect(page.getByRole("button", { name: new RegExp(module) })).toBeVisible();
  }
  await expect(page.getByText("3 módulos · 8 aulas")).toBeVisible();

  // Same folder again: points to the existing course instead of duplicating it.
  await page.goto("/");
  await page.getByRole("button", { name: "Importar curso" }).click();
  await dialog.getByLabel("Link da pasta do curso no Google Drive").fill(course_link);
  await dialog.getByRole("button", { name: "Importar curso" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Esta pasta já foi importada.");
  await expect(dialog.getByRole("link", { name: "Abrir o curso" })).toBeVisible();
});
