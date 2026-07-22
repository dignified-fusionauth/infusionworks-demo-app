import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/session";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/directory",
  "/approvals",
  "/admin",
  "/settings",
];

/**
 * A lightweight presence check only — it confirms the encrypted `fw_session`
 * cookie is there, without decrypting or verifying it. Full verification happens
 * in each page/route via `getSession()` (which decrypts the cookie AND checks
 * the enclosed access token against JWKS). This just keeps signed-out visitors
 * from loading protected pages at all.
 *
 * Named `proxy` (not `middleware`) per the Next.js 16 convention — `middleware`
 * was deprecated and renamed to `proxy` in v16, and proxy runs on the Node.js
 * runtime by default.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.has(sessionCookieName);
  if (!hasSession) {
    const loginUrl = new URL("/api/auth/login", request.url);
    loginUrl.searchParams.set("redirect_uri", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/directory/:path*",
    "/approvals/:path*",
    "/admin/:path*",
    "/settings/:path*",
  ],
};
