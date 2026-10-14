import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Pages that work without a session.
const PUBLIC = /^\/(api|login|offline)(\/|$)/;

/**
 * Production answers on one address only. A deployment's own URL
 * (aop-inbox-<hash>-<team>.vercel.app) can't sign in — auth trusts the canonical
 * origin — and a random-looking host with a login form reads as phishing to browsers.
 */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  const canonical = process.env.BETTER_AUTH_URL;
  // Pages only: crons and webhooks may call a deployment URL directly and don't follow redirects.
  if (process.env.VERCEL_ENV !== "production" || !canonical || request.nextUrl.pathname.startsWith("/api/")) return null;
  if (!["GET", "HEAD"].includes(request.method)) return null;
  const target = new URL(canonical);
  if (request.nextUrl.host === target.host) return null;
  // Set the path on the canonical URL; resolving "//evil.com" against it would swap the host.
  const url = new URL(target.origin);
  url.pathname = request.nextUrl.pathname;
  url.search = request.nextUrl.search;
  return NextResponse.redirect(url, 308);
}

/**
 * Optimistic gate only (cookie presence). Real session validation happens in
 * every route handler and in the app layout — never trust this alone.
 */
export function proxy(request: NextRequest) {
  const redirect = canonicalRedirect(request);
  if (redirect) return redirect;
  if (PUBLIC.test(request.nextUrl.pathname)) return NextResponse.next();

  const hasSession = Boolean(getSessionCookie(request, { cookiePrefix: "aop" }));
  if (!hasSession) {
    const login = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|manifest.webmanifest|sw.js|icons|favicon.ico|robots.txt).*)"],
};
