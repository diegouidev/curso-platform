import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, lessonUrl, test } from "./fixtures";

/** WCAG 2.1 A/AA checks. The Drive iframe is third-party content and is left out. */
async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("iframe")
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(summary, `${label}\n${summary.join("\n")}`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`acessibilidade (${scheme === "light" ? "tema claro" : "tema escuro"})`, () => {
    test.use({ colorScheme: scheme });

    test("login", async ({ page, seed }) => {
      await seed({ course: false, login: false });
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
      await expectNoViolations(page, "login");
    });

    test("telas principais", async ({ page, seed }) => {
      const s = await seed();
      const pages: [string, string][] = [
        ["/", "Olá, e2e"],
        [`/courses/${s.course_id}`, "Curso E2E de Python"],
        [lessonUrl(s, "02 - Variáveis"), "02 - Variáveis"],
        [`/courses/${s.course_id}/organize`, "Organizar curso"],
        ["/settings", "Configurações"],
      ];
      for (const [url, heading] of pages) {
        await page.goto(url);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expectNoViolations(page, url);
      }

      await page.keyboard.press("Control+k");
      await page.getByRole("combobox").fill("aula");
      await expect(page.getByRole("option").first()).toBeVisible();
      await expectNoViolations(page, "busca");
    });
  });
}
