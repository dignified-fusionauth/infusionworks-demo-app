import { NextRequest } from "next/server";
import { startOAuthRedirect } from "@/lib/bff";

/**
 * GET /api/auth/login
 *
 * Starts the Authorization Code + PKCE redirect to FusionAuth's hosted login.
 * Query params (all optional):
 *   - idpHint      -> deep-link straight to one company's IdP (idp_hint). Also
 *                     used to derive the required tenant for the Universal
 *                     Application when tenantId is omitted (see startOAuthRedirect).
 *   - loginHint    -> route by work-email managed domain (login_hint)
 *   - tenantId     -> pin a specific FusionAuth tenant (overrides IdP derivation)
 *   - redirect_uri -> same-origin path to land on after login (default /dashboard)
 *
 * This is also where FusionAuth's hosted pages run any Intelligent MFA policy —
 * no app code changes for it.
 */
export async function GET(request: NextRequest) {
  return await startOAuthRedirect(request);
}
