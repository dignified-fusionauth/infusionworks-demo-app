import { NextRequest, NextResponse } from "next/server";
import { accountManagementUrl } from "@/lib/fusionauth";
import { getSession } from "@/lib/session";

/**
 * GET /settings/account
 *
 * Hands the employee off to FusionAuth's hosted self-service account pages
 * rather than FusionWorks building its own profile/password/MFA screens. This
 * path is already covered by proxy.ts, but we re-check the session here too and
 * send a signed-out visitor to login (same-origin) rather than out to FusionAuth.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(
      new URL("/api/auth/login?redirect_uri=/settings", request.url)
    );
  }
  return NextResponse.redirect(accountManagementUrl());
}
