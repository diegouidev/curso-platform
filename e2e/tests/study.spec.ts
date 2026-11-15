import { expect, lessonUrl, openLesson, test } from "./fixtures";

test("marca aulas e encontra em Marcadas", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "01 - Introdução");

  const favorite = page.getByRole("button", { name: "Favorita" });
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Difícil" }).click();
  await expect(page.getByRole("button", { name: "Difícil" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The course page shows the star next to the lesson.
  await page.goto(`/courses/${s.course_id}`);
  await page.getByRole("button", { name: /Módulo 1 - Fundamentos/ }).click();
  await expect(
    page.getByRole("link", { name: /01 - Introdução/ }).getByLabel("Favorita"),
  ).toBeVisible();

  await page.goto("/marked");
  await expect(page.getByRole("link", { name: /01 - Introdução/ })).toBeVisible();
  await page.getByRole("tab", { name: /Difíceis/ }).click();
  await page.getByRole("button", { name: "Tirar “Difícil” de 01 - Introdução" }).click();
  await expect(page.getByText("Nenhuma aula marcada como difícil.")).toBeVisible();
  await page.getByRole("tab", { name: /Favoritas/ }).click();
  await expect(page.getByRole("link", { name: /01 - Introdução/ })).toBeVisible();
});

test("pergunta na anotação vira cartão de revisão", async ({ page, seed }) => {
  const s = await seed();
  await openLesson(page, s, "02 - Variáveis");

  const note = page.getByRole("textbox", { name: "Minhas anotações" });
  await note.fill("Resumo da aula\n\nP: Quanto é 2 + 2?\nR: Quatro");
  await expect(page.getByText(/Salvo às/)).toBeVisible();
  await expect(page.getByText("1 cartão de revisão nesta anotação.")).toBeVisible();

  await page.goto("/review");
  await expect(page.getByText("Quanto é 2 + 2?")).toBeVisible();
  await expect(page.getByText("Quatro")).toBeHidden();
  await page.keyboard.press("Space");
  await expect(page.getByText("Quatro")).toBeVisible();
  await page.getByRole("button", { name: /Bom/ }).click();
  await expect(page.getByRole("heading", { name: "Revisão de hoje concluída" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Nada para revisar hoje" })).toBeVisible();
});

test("minutagem na anotação abre o Drive no ponto e aparece no caderno", async ({
  page,
  seed,
}) => {
  const s = await seed();
  await openLesson(page, s, "01 - Introdução");

  const note = page.getByRole("textbox", { name: "Minhas anotações" });
  await note.click();
  await page.getByRole("button", { name: "Minutagem" }).click();
  await page.keyboard.type("1:05"); // replaces the selected "00:00"
  await page.keyboard.press("End");
  await page.keyboard.type("explica variáveis");
  await expect(note).toHaveValue("[1:05] explica variáveis");
  await expect(page.getByText(/Salvo às/)).toBeVisible();

  await page.getByRole("tab", { name: "Visualizar" }).click();
  const stamp = page.getByRole("link", { name: "1:05" });
  await expect(stamp).toHaveAttribute("href", /\/file\/d\/e2e-m1-intro-video\/view\?t=65s/);

  await page.goto(`/courses/${s.course_id}/notebook`);
  await expect(page.getByRole("heading", { level: 1, name: "Caderno de anotações" })).toBeVisible();
  await expect(page.getByText("explica variáveis")).toBeVisible();
  await expect(page.getByRole("link", { name: "1:05" })).toHaveAttribute("href", /t=65s/);
  await page.getByRole("link", { name: /01 - Introdução/ }).click();
  await expect(page).toHaveURL(lessonUrl(s, "01 - Introdução"));
});

test("prazo do curso mostra o ritmo necessário", async ({ page, seed }) => {
  const s = await seed();
  await page.goto(`/courses/${s.course_id}`);

  await page.getByRole("button", { name: "Definir prazo" }).click();
  const dialog = page.getByRole("dialog", { name: "Prazo para terminar" });
  await dialog.getByRole("button", { name: "1 mês" }).click();
  await dialog.getByRole("button", { name: "Salvar" }).click();

  await expect(page.getByText("Prazo salvo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Terminar até/ })).toBeVisible();
  await expect(page.getByText("Precisa de")).toBeVisible();
  await expect(page.getByText("31 dias")).toBeVisible();

  // The dashboard card shows the deadline too.
  await page.goto("/");
  await expect(page.getByText(/· até \d{2}\/\d{2}/)).toBeVisible();
});

test("tags do curso aparecem no card do início", async ({ page, seed }) => {
  const s = await seed();
  await page.goto(`/courses/${s.course_id}`);
  await page.getByRole("button", { name: "Mais ações do curso" }).click();
  await page.getByRole("menuitem", { name: /Editar título/ }).click();

  const dialog = page.getByRole("dialog", { name: "Editar curso" });
  const tags = dialog.getByRole("combobox", { name: "Tags" });
  await tags.fill("Programação, Python,");
  await expect(dialog.getByRole("button", { name: "Remover tag Python" })).toBeVisible();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Curso atualizado.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Tags" }).getByText("Programação")).toBeVisible();

  await page.goto("/");
  const card = page.getByRole("link", { name: /Curso E2E de Python/ });
  await expect(card.getByText("Python", { exact: true })).toBeVisible();
});

test("metas aparecem no início", async ({ page, seed }) => {
  await seed();
  await page.goto("/settings");
  await page.getByLabel("Por dia").selectOption("30");
  await expect(page.getByText("Meta salva.")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("meter", { name: "Meta do dia" })).toBeVisible();
  await expect(page.getByText("0 de 30 min")).toBeVisible();
});
