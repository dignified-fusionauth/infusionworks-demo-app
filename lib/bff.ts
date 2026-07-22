import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, fusionAuthConfig } from "@/lib/fusionauth";
import { randomUrlSafeString, codeChallengeFromVerifier } from "@/lib/pkce";

/**
 * Shared helpers for the /api/auth/* routes: the Authorization Code + PKCE
 * round trip and the open-redirect guards around it. FusionWorks has no browser
 * SDK, so these routes are the entire auth surface.
 */

// Short-lived cookies that only need to survive the authorize round trip.
export const STATE_COOKIE = "fw_oauth_state";
export const VERIFIER_COOKIE = "fw_pkce_verifier";
export const RETURN_COOKIE = "fw_return_to";

const TEMP_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 10, // 10 minutes
};

function appOrigin() {
  return new URL(fusionAuthConfig.appBaseUrl).origin;
}

/**
 * Reduces a caller-supplied return target to a safe SAME-ORIGIN relative path,
 * so /api/auth/login can't be turned into an open redirect.
 */
export function safeReturnTo(raw: string | null): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  try {
    const url = new URL(raw, fusionAuthConfig.appBaseUrl);
    if (url.origin !== appOrigin()) return fallback;
    return `${url.pathname}${url.search}` || fallback;
  } catch {
    return fallback;
  }
}

/** Same idea for the post-logout redirect, but FusionAuth needs an absolute URL. */
export function safePostLogoutRedirect(raw: string | null): string {
  if (!raw) return fusionAuthConfig.appBaseUrl;
  try {
    const url = new URL(raw, fusionAuthConfig.appBaseUrl);
    if (url.origin !== appOrigin()) return fusionAuthConfig.appBaseUrl;
    // FusionAuth validates post_logout_redirect_uri against the application's
    // Authorized redirect URLs with an EXACT string match, so the trailing "/"
    // matters. The URL serializer always appends "/" to a bare origin; drop it
    // so the value matches an origin registered without a trailing slash.
    return url.pathname === "/" && !url.search && !url.hash
      ? url.origin
      : url.toString();
  } catch {
    return fusionAuthConfig.appBaseUrl;
  }
}

/**
 * Starts the Authorization Code + PKCE redirect. Reads the B2B2E SSO hints off
 * the query (`idpHint` / `loginHint` / `tenantId`) and passes them through so a
 * company button deep-links to its own IdP and the work-email form routes by
 * managed domain. Stores state/verifier/return in short-lived cookies for the
 * callback to validate.
 */
export function startOAuthRedirect(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const state = randomUrlSafeString(16);
  const codeVerifier = randomUrlSafeString(32);
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);
  const returnTo = safeReturnTo(q.get("redirect_uri"));

  const authorizeUrl = buildAuthorizeUrl({
    state,
    codeChallenge,
    idpHint: q.get("idpHint") || undefined,
    loginHint: q.get("loginHint") || undefined,
    tenantId: q.get("tenantId") || undefined,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, TEMP_COOKIE_OPTS);
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, TEMP_COOKIE_OPTS);
  response.cookies.set(RETURN_COOKIE, returnTo, TEMP_COOKIE_OPTS);
  return response;
}
