import { expect, test } from "./fixtures";

test("protege as rotas, faz login e sai", async ({ page, seed }) => {
  const { username, password } = await seed({ course: false, login: false });

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);

  await page.getByLabel("Usuário").fill(username);
  await page.getByLabel("Senha", { exact: true }).fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Usuário ou senha inválidos.")).toBeVisible();

  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Back to where it was going.
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();

  await page.getByRole("button", { name: "Menu da conta" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
