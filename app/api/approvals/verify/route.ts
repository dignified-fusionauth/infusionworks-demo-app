import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { completeTwoFactorLogin } from "@/lib/fusionauth";
import { canApprove } from "@/lib/roles";
import { expenseReports, payrollSummary } from "@/lib/org";
import { approvalReference } from "@/app/api/approvals/expense/route";

/**
 * POST /api/approvals/verify
 * Body: { twoFactorId, code, action, expenseId? }
 *
 * Completes a step-up challenge started by /api/approvals/payroll or
 * /api/approvals/expense (POST /api/two-factor/login under the hood). On
 * success it returns the same protected payload the action would have returned
 * without a challenge, so the UI has one place to render the result.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { twoFactorId, code, action, expenseId } = (body ?? {}) as {
    twoFactorId?: unknown;
    code?: unknown;
    action?: unknown;
    expenseId?: unknown;
  };

  if (typeof twoFactorId !== "string" || typeof code !== "string" || !code) {
    return NextResponse.json({ error: "Missing verification code" }, { status: 400 });
  }

  const result = await completeTwoFactorLogin({ twoFactorId, code });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (action === "view-payroll") {
    return NextResponse.json({ completed: true, payroll: payrollSummary });
  }

  if (action === "approve-expense") {
    if (!canApprove(session.roles)) {
      return NextResponse.json(
        { error: "Your role can't approve expenses." },
        { status: 403 }
      );
    }
    const report =
      typeof expenseId === "string"
        ? expenseReports.find((r) => r.id === expenseId)
        : undefined;
    if (!report) {
      return NextResponse.json({ error: "Unknown expense report" }, { status: 400 });
    }
    return NextResponse.json({
      completed: true,
      reference: approvalReference(report.id),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
