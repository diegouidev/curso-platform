import { test as base, expect, type Locator, type Page } from "@playwright/test";

export type Seed = {
  username: string;
  password: string;
  course_id: number | null;
  course_folder_id: string;
  course_link: string;
  /** Lesson id by title (empty when the course wasn't imported). */
  lessons: Record<string, number>;
};

type SeedOptions = { course?: boolean; login?: boolean };

const STUB_PLAYER = `<!doctype html><html><body style="margin:0;display:grid;place-items:center;
height:100vh;background:#111;color:#eee;font:16px sans-serif">Player do Drive (simulado)</body></html>`;

export const test = base.extend<{ seed: (options?: SeedOptions) => Promise<Seed> }>({
  page: async ({ page }, use) => {
    // No Google session here: the Drive embed and Docs previews are stubbed.
    for (const host of ["https://drive.google.com/**", "https://docs.google.com/**"]) {
      await page.route(host, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: STUB_PLAYER }),
      );
    }
    await use(page);
  },

  /** Fresh backend state (optionally with the fake course imported) and a logged-in session. */
  seed: async ({ page }, use) => {
    await use(async ({ course = true, login = true } = {}) => {
      const reset = await page.request.post(`/api/e2e/reset${course ? "?course=1" : ""}`);
      expect(reset.ok(), await reset.text()).toBeTruthy();
      const seed = (await reset.json()) as Seed;
      if (login) {
        // The browser context shares cookies with page.request: this sets the refresh cookie.
        const response = await page.request.post("/api/auth/login", {
          data: { username: seed.username, password: seed.password },
        });
        expect(response.ok()).toBeTruthy();
      }
      return seed;
    });
  },
});

export { expect };

export function lessonUrl(seed: Seed, title: string): string {
  const id = seed.lessons[title];
  if (id == null) throw new Error(`No lesson "${title}" in the E2E course`);
  return `/courses/${seed.course_id}/lessons/${id}`;
}

export async function openLesson(page: Page, seed: Seed, title: string): Promise<void> {
  await page.goto(lessonUrl(seed, title));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

export function player(page: Page): Locator {
  return page.locator('iframe[title^="Vídeo:"]');
}
