import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { checkTwoFactorStatus, startTwoFactorChallenge } from "@/lib/fusionauth";
import { payrollSummary } from "@/lib/org";

/**
 * POST /api/approvals/payroll
 *
 * The step-up-auth demo, payroll edition. Browsing the app needs no MFA;
 * revealing compensation data is sensitive, so before FusionWorks returns it we
 * ask FusionAuth: "does this user need to re-verify to do this?"
 *
 *  - 200 (no challenge)  -> return the payroll summary immediately.
 *  - 242 (challenge)     -> return a twoFactorId + methods; the UI collects a
 *                           code and calls /api/approvals/verify, which returns
 *                           the payroll data on success.
 *
 * Runs with FusionWorks' own API key, never the user's token — the two-factor
 * endpoints are privileged FusionAuth APIs.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const clientIp = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    .trim();

  const status = await checkTwoFactorStatus({
    userId: session.userId,
    action: "view-payroll",
    ipAddress: clientIp || undefined,
  });

  if (status.challengeRequired) {
    const challenge = await startTwoFactorChallenge({ userId: session.userId });
    return NextResponse.json({
      requiresMfa: true,
      twoFactorId: challenge.twoFactorId,
      methods: challenge.methods,
    });
  }

  return NextResponse.json({
    requiresMfa: false,
    completed: true,
    payroll: payrollSummary,
  });
}
