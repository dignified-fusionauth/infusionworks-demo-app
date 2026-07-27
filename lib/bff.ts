import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  fusionAuthConfig,
  getTenantIdForIdp,
} from "@/lib/fusionauth";
import { randomUrlSafeString, codeChallengeFromVerifier } from "@/lib/pkce";

/**
 * Shared helpers for the /api/auth/* routes: the Authorization Code + PKCE
 * round trip and the open-redirect guards around it. InFusion Works has no browser
 * SDK, so these routes are the entire auth surface.
 */

// Short-lived cookies that only need to survive the authorize round trip.
export const STATE_COOKIE = "fw_oauth_state";
export const VERIFIER_COOKIE = "fw_pkce_verifier";
export const RETURN_COOKIE = "fw_return_to";
// The tenant the login ran in, so the callback's token exchange can pin the
// same tenant (a universal-app /oauth2/token call requires it).
export const TENANT_COOKIE = "fw_oauth_tenant";

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

/**
 * Starts the Authorization Code + PKCE redirect. Reads the B2B2E SSO hints off
 * the query (`idpHint` / `loginHint` / `tenantId`) and passes them through so a
 * company button deep-links to its own IdP and the work-email form routes by
 * managed domain. Stores state/verifier/return in short-lived cookies for the
 * callback to validate.
 *
 * Because InFusion Works uses a Universal Application, the authorize URL must
 * name the tenant (a universal app isn't tenant-bound, so FusionAuth can't infer
 * it). Unless the caller pins an explicit `tenantId`, we derive it from the
 * company's tenant-scoped IdP named by `idpHint`. See getTenantIdForIdp.
 */
export async function startOAuthRedirect(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const state = randomUrlSafeString(16);
  const codeVerifier = randomUrlSafeString(32);
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);
  const returnTo = safeReturnTo(q.get("redirect_uri"));

  const idpHint = q.get("idpHint") || undefined;
  const explicitTenant = q.get("tenantId") || undefined;
  const tenantId =
    explicitTenant ?? (idpHint ? await getTenantIdForIdp(idpHint) : undefined);

  const authorizeUrl = buildAuthorizeUrl({
    state,
    codeChallenge,
    idpHint,
    loginHint: q.get("loginHint") || undefined,
    tenantId,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, TEMP_COOKIE_OPTS);
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, TEMP_COOKIE_OPTS);
  response.cookies.set(RETURN_COOKIE, returnTo, TEMP_COOKIE_OPTS);
  // Remember which tenant this login used, so the callback pins the same tenant
  // on the token exchange (required for the universal app).
  if (tenantId) response.cookies.set(TENANT_COOKIE, tenantId, TEMP_COOKIE_OPTS);
  return response;
}
