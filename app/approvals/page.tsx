import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import ApprovalActions, { type ExpenseRow } from "@/components/ApprovalActions";
import { getSession } from "@/lib/session";
import { canApprove } from "@/lib/roles";
import { expenseReports } from "@/lib/org";

/**
 * The step-up-auth demo. Browsing FusionWorks needs no MFA, but revealing
 * payroll or approving an expense re-checks the user's identity mid-session —
 * the same pattern as FusionBank's transfer flow. The actual status/challenge/
 * verify round trip runs server-side in /api/approvals/* with FusionWorks' API
 * key; this page just hands the client component the data and role gate.
 */
export default async function ApprovalsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/login?redirect_uri=/approvals");

  // Presentational-only expense rows for the client component (no server-only
  // fields leak; the approve action re-verifies role + step-up on the server).
  const expenses: ExpenseRow[] = expenseReports
    .filter((r) => r.status === "pending")
    .map((r) => ({
      id: r.id,
      submitter: r.submitter,
      category: r.category,
      amountCents: r.amountCents,
      submitted: r.submitted,
    }));

  return (
    <AppShell session={session}>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink font-[family-name:var(--font-display)]">
          Approvals
        </h1>
        <p className="mt-2 text-ink-soft">
          Sensitive actions re-check your identity even though you&rsquo;re
          already signed in. FusionWorks asks FusionAuth whether a step-up
          challenge is required, and if so you&rsquo;ll re-swipe your badge (a
          two-factor code) before the data unlocks.
        </p>
      </div>

      <div className="mt-8">
        <ApprovalActions canApprove={canApprove(session.roles)} expenses={expenses} />
      </div>
    </AppShell>
  );
}
