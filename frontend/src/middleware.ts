import { NextResponse, type NextRequest } from "next/server";

import { PUBLIC_PATHS, REFRESH_COOKIE, loginUrl } from "@/lib/auth";

/**
 * Route guard: without the refresh cookie every page redirects to /login.
 * This only checks presence; the API validates the token. A stale cookie is cleared by the
 * backend on the first failed refresh, after which the client lands back on /login.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(REFRESH_COOKIE);
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL(loginUrl(pathname + search), request.url));
  }
  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the API proxy, Next internals and static files.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|ico|webp)$).*)",
  ],
};
