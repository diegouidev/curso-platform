import { expect, lessonUrl, openLesson, test } from "./fixtures";

test("anotação em markdown salva sozinha e aparece na busca", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "02 - Variáveis");

  const editor = page.getByRole("textbox", { name: "Minhas anotações" });
  await editor.fill("# Resumo\n\nO **padrão Observer** desacopla quem publica de quem assina.");
  await expect(page.getByText(/Salvo às \d{2}:\d{2}/)).toBeVisible();

  await page.reload();
  await expect(editor).toHaveValue(/padrão Observer/);
  await page.getByRole("tab", { name: "Visualizar" }).click();
  const preview = page.getByRole("tabpanel");
  await expect(preview.getByRole("heading", { name: "Resumo" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("padrão Observer");

  // Ctrl+K from another page, accent-insensitive, straight into the lesson.
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog");
  await search.getByRole("combobox").fill("padrao observer");
  const result = search.getByRole("option", { name: /02 - Variáveis/ }).last();
  await expect(result).toContainText("Observer");
  await expect(result.locator("mark")).toHaveText(/padrão/i);
  await result.click();
  await expect(page).toHaveURL(lessonUrl(s, "02 - Variáveis"));
});

test("busca encontra aulas e cursos, e avisa quando não há nada", async ({ page, seed }) => {
  await seed();
  await page.goto("/");
  await page.getByRole("button", { name: "Buscar…" }).click();
  const search = page.getByRole("dialog");
  const input = search.getByRole("combobox");

  await input.fill("a");
  await expect(search.getByText("Digite pelo menos 2 letras.")).toBeVisible();
  await input.fill("introducao");
  await expect(search.getByRole("option", { name: /01 - Introdução/ })).toBeVisible();
  await input.fill("python");
  await expect(search.getByRole("option", { name: /Curso E2E de Python/ })).toBeVisible();
  await input.fill("kubernetes");
  await expect(search.getByText("Nada encontrado para “kubernetes”.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
});

test("estatísticas do dashboard refletem o estudo", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "01 - Introdução");
  await page.getByRole("button", { name: "Marcar como concluída" }).click();
  await expect(page.getByRole("button", { name: "Concluída", exact: true })).toBeVisible();

  await page.goto("/");
  const stats = page.getByRole("region", { name: "Estatísticas de estudo" });
  await expect(stats.getByText("Aulas concluídas esta semana")).toBeVisible();
  await expect(stats.getByText("1 aula concluída no total")).toBeVisible();
  await expect(stats.getByText("1 dia")).toBeVisible();
});
