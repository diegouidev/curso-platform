import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

export type User = components["schemas"]["User"];
export type Session = components["schemas"]["AccessToken"];

/**
 * Session handling:
 * - The access token lives only in memory (never in localStorage).
 * - The refresh token is an httpOnly cookie managed by the backend; the browser sends it
 *   automatically because /api/* is proxied through this same origin.
 * - A 401 triggers a single shared refresh and one retry of the original request.
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<Session | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  refreshInFlight ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then(async (response) => (response.ok ? ((await response.json()) as Session) : null))
    .catch(() => null)
    .then((session) => {
      accessToken = session?.access ?? null;
      return session;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

const AUTH_ENDPOINTS = ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"];

function withAuth(request: Request): Request {
  if (!accessToken) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return new Request(request, { headers });
}

async function authFetch(request: Request): Promise<Response> {
  const retry = request.clone();
  const response = await fetch(withAuth(request));

  const { pathname } = new URL(request.url);
  if (response.status !== 401 || AUTH_ENDPOINTS.includes(pathname)) return response;

  const session = await refreshSession();
  if (!session) {
    onSessionExpired?.();
    return response;
  }
  return fetch(withAuth(retry));
}

export const api = createClient<paths>({
  baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  credentials: "same-origin",
  fetch: authFetch,
});

/** Extracts the DRF error message (`detail`) or falls back to a generic one. */
export function errorMessage(
  error: unknown,
  fallback = "Algo deu errado. Tente novamente.",
): string {
  if (error && typeof error === "object" && "detail" in error && typeof error.detail === "string") {
    return error.detail;
  }
  return fallback;
}
