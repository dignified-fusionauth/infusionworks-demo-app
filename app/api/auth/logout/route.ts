import { NextRequest, NextResponse } from "next/server";
import { buildLogoutUrl } from "@/lib/fusionauth";
import { clearSession } from "@/lib/session";
import { safePostLogoutRedirect } from "@/lib/bff";

/**
 * GET /api/auth/logout
 *
 * Clears the local encrypted session cookie, then bounces to FusionAuth's
 * /oauth2/logout so the hosted SSO session is ended too (single logout). The
 * post-logout target is validated to this app's origin.
 */
export async function GET(request: NextRequest) {
  await clearSession();
  const redirectTo = safePostLogoutRedirect(
    request.nextUrl.searchParams.get("redirect_uri")
  );
  return NextResponse.redirect(buildLogoutUrl(redirectTo));
}
