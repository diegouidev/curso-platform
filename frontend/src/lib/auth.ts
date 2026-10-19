/** Shared by the middleware (edge) and client code: keep it free of browser/Node APIs. */

export const REFRESH_COOKIE = process.env.AUTH_COOKIE_NAME ?? "refresh_token";

export const PUBLIC_PATHS = ["/login"];

/** Only same-origin relative paths are accepted as post-login redirects (no open redirect). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}

export function loginUrl(from?: string | null): string {
  const next = safeNextPath(from);
  return next === "/" || PUBLIC_PATHS.includes(next)
    ? "/login"
    : `/login?next=${encodeURIComponent(next)}`;
}
