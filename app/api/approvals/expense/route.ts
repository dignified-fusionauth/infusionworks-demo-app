import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { checkTwoFactorStatus, startTwoFactorChallenge } from "@/lib/fusionauth";
import { canApprove } from "@/lib/roles";
import { expenseReports } from "@/lib/org";

/**
 * POST /api/approvals/expense
 * Body: { expenseId }
 *
 * Approving an expense report is a sensitive action, so it's step-up protected
 * the same way payroll is. Only managers/admins may approve (role check off the
 * verified access token) — a nice pairing of coarse RBAC with a per-action MFA
 * re-check.
 *
 *  - 200 -> approval completes, returns a reference.
 *  - 242 -> returns a twoFactorId + methods for /api/approvals/verify.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!canApprove(session.roles)) {
    return NextResponse.json(
      { error: "Your role can't approve expenses." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { expenseId } = (body ?? {}) as { expenseId?: unknown };
  const report =
    typeof expenseId === "string"
      ? expenseReports.find((r) => r.id === expenseId)
      : undefined;
  if (!report) {
    return NextResponse.json({ error: "Unknown expense report" }, { status: 400 });
  }

  const clientIp = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    .trim();

  const status = await checkTwoFactorStatus({
    userId: session.userId,
    action: "approve-expense",
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
    reference: approvalReference(report.id),
  });
}

/** A fake approval reference; FusionWorks has no real approvals ledger. */
export function approvalReference(expenseId: string): string {
  return `FW-${expenseId.replace(/[^0-9A-Z]/gi, "")}-OK`;
}
