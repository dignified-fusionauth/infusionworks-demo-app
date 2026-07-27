import { NextResponse } from "next/server";
import { buildAccountLogoutUrl } from "@/lib/fusionauth";
import { clearSession, getSession } from "@/lib/session";

/**
 * GET /api/auth/logout
 *
 * Clears the local encrypted session cookie, then sends the browser on a single
 * top-level navigation to /account/logout. Because self-service account
 * management is enabled, the hosted /account pages hold a session separate from
 * both this app's session and the FusionAuth SSO session; /account/logout ends
 * that account session and chains into /oauth2/logout, ending the SSO session
 * too (single logout). See buildAccountLogoutUrl for why `client_id` is the only
 * parameter and where the final landing page comes from (the application's
 * configured Logout URL in FusionAuth), which is why there's no redirect_uri
 * handling here.
 *
 * We read the session's tenant (the access token's `tid` claim) BEFORE clearing
 * it, because a multi-tenant instance rejects the logout with `missing_tenant_id`
 * unless `tenantId` is supplied. See buildAccountLogoutUrl.
 */
export async function GET() {
  const session = await getSession();
  await clearSession();
  return NextResponse.redirect(buildAccountLogoutUrl(session?.tenantId));
}
