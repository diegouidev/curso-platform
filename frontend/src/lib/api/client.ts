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

/**
 * Raw authenticated fetch (same token refresh as `api`) for what the typed client handles
 * poorly: multipart uploads (the browser must set the boundary) and file downloads.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return authFetch(new Request(new URL(path, window.location.origin), init));
}

export const api = createClient<paths>({
  baseUrl: typeof window === "undefined" ? "http://localhost" : window.location.origin,
  credentials: "same-origin",
  fetch: authFetch,
});

/** Extracts a readable message from a DRF error body (`detail` or the first field error). */
export function errorMessage(
  error: unknown,
  fallback = "Algo deu errado. Tente novamente.",
): string {
  if (error && typeof error === "object") {
    if ("detail" in error && typeof error.detail === "string") return error.detail;
    for (const value of Object.values(error)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(status: number, body: unknown, fallback?: string) {
    super(errorMessage(body, fallback));
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code =
      body && typeof body === "object" && "code" in body && typeof body.code === "string"
        ? body.code
        : undefined;
  }
}

/** Turns an openapi-fetch result into data-or-throw, which is what TanStack Query expects. */
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok) throw new ApiError(response.status, error);
  return data as T;
}
