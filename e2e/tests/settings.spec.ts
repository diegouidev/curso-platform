import { readFile } from "node:fs/promises";

import { expect, openLesson, test } from "./fixtures";

test("preferência de conclusão e tema ficam salvos", async ({ page, seed }) => {
  await seed({ course: false });
  await page.goto("/settings");

  const suggest = page.getByRole("switch", { name: /Sugerir conclusão/ });
  await expect(suggest).toBeChecked();
  await page.getByLabel("Sugerir depois de").selectOption("75");
  await expect(page.getByText("Preferência salva.").first()).toBeVisible();
  await suggest.click();
  await expect(suggest).not.toBeChecked();

  await page.getByRole("radio", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.getByRole("switch", { name: /Sugerir conclusão/ })).not.toBeChecked();
  await expect(page.getByLabel("Sugerir depois de")).toHaveValue("75");
  await expect(page.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");
});

test("exporta o backup e restaura em uma instalação limpa", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "01 - Introdução");
  await page.getByRole("button", { name: "Marcar como concluída" }).click();
  await page.getByRole("textbox", { name: "Minhas anotações" }).fill("Anotação para o backup");
  await expect(page.getByText(/Salvo às/)).toBeVisible();

  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Backup completo (JSON)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^backup-estudos-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const backup = JSON.parse(await readFile(path, "utf-8"));
  expect(backup.format).toBe("curso-platform-backup");

  const [markdown] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Anotações (Markdown)" }).click(),
  ]);
  expect(await readFile(await markdown.path(), "utf-8")).toContain("Anotação para o backup");

  // Same course imported again from scratch, then the backup restored on top.
  const fresh = await seed();
  await page.goto("/settings");
  await page.getByLabel("Arquivo de backup").setInputFiles(path);
  await page.getByRole("dialog").getByRole("button", { name: "Importar" }).click();
  const summary = page.getByRole("status").filter({ hasText: "Backup importado" });
  await expect(summary).toContainText("1 progresso atualizado");
  await expect(summary).toContainText("1 anotação restaurada");

  await openLesson(page, fresh, "01 - Introdução");
  await expect(page.getByRole("button", { name: "Concluída", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Minhas anotações" })).toHaveValue(
    "Anotação para o backup",
  );
});
