"use client";

import { useState } from "react";
import BadgeReswipe, { type ReswipeMethod } from "@/components/BadgeReswipe";

/** Local money formatter so this client component doesn't import server data. */
function fmt(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface PayrollRow {
  department: string;
  headcount: number;
  monthlyCents: number;
}

export interface ExpenseRow {
  id: string;
  submitter: string;
  category: string;
  amountCents: number;
  submitted: string;
}

type StepUpAction = "view-payroll" | "approve-expense";

interface Challenge {
  action: StepUpAction;
  expenseId?: string;
  twoFactorId: string;
  methods: ReswipeMethod[];
}

interface ApprovalActionsProps {
  canApprove: boolean;
  expenses: ExpenseRow[];
}

/**
 * Drives both step-up-protected actions. Each action posts to its route; a 242
 * comes back as `requiresMfa` with a twoFactorId + methods, which flips the UI
 * into the BadgeReswipe challenge. The entered code goes to /api/approvals/verify,
 * which returns the protected payload (payroll data / approval reference).
 */
export default function ApprovalActions({
  canApprove,
  expenses,
}: ApprovalActionsProps) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // action label in-flight
  const [error, setError] = useState<string | undefined>();

  const [payroll, setPayroll] = useState<PayrollRow[] | null>(null);
  const [approved, setApproved] = useState<Record<string, string>>({});

  async function begin(action: StepUpAction, expenseId?: string) {
    setError(undefined);
    setBusy(expenseId ?? action);
    try {
      const url =
        action === "view-payroll"
          ? "/api/approvals/payroll"
          : "/api/approvals/expense";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expenseId ? { expenseId } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      if (data.requiresMfa) {
        setChallenge({
          action,
          expenseId,
          twoFactorId: data.twoFactorId,
          methods: data.methods ?? [],
        });
        return;
      }
      applyResult(action, expenseId, data);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function submitCode(code: string) {
    if (!challenge) return;
    setError(undefined);
    setBusy("verify");
    try {
      const res = await fetch("/api/approvals/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: challenge.action,
          expenseId: challenge.expenseId,
          twoFactorId: challenge.twoFactorId,
          code,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed.");
        return;
      }
      applyResult(challenge.action, challenge.expenseId, data);
      setChallenge(null);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function applyResult(
    action: StepUpAction,
    expenseId: string | undefined,
    data: { payroll?: PayrollRow[]; reference?: string }
  ) {
    if (action === "view-payroll" && data.payroll) {
      setPayroll(data.payroll);
    } else if (action === "approve-expense" && expenseId && data.reference) {
      setApproved((prev) => ({ ...prev, [expenseId]: data.reference! }));
    }
  }

  const challengeTitle =
    challenge?.action === "view-payroll"
      ? "Viewing the payroll summary needs a fresh check."
      : "Approving this expense needs a fresh check.";

  return (
    <div className="space-y-8">
      {challenge ? (
        <BadgeReswipe
          title={challengeTitle}
          methods={challenge.methods}
          busy={busy === "verify"}
          error={error}
          onSubmit={submitCode}
          onCancel={() => {
            setChallenge(null);
            setError(undefined);
          }}
        />
      ) : null}

      {/* Payroll */}
      <section className="rounded-xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink font-[family-name:var(--font-display)]">
              Payroll summary
            </h2>
            <p className="text-sm text-ink-soft">
              Compensation totals by department. Step-up protected.
            </p>
          </div>
          {!payroll ? (
            <button
              onClick={() => begin("view-payroll")}
              disabled={!!busy}
              className="shrink-0 rounded-lg bg-brand px-4 py-2 font-semibold text-white transition hover:bg-brand-ink disabled:opacity-50"
            >
              {busy === "view-payroll" ? "Checking…" : "View payroll"}
            </button>
          ) : (
            <span className="rounded-full bg-verified-soft px-3 py-1 text-xs font-semibold text-verified">
              Unlocked
            </span>
          )}
        </div>

        {payroll ? (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-soft">
                <th className="py-2 font-medium">Department</th>
                <th className="py-2 text-right font-medium">Headcount</th>
                <th className="py-2 text-right font-medium">Monthly</th>
              </tr>
            </thead>
            <tbody>
              {payroll.map((row) => (
                <tr key={row.department} className="border-b border-line/60">
                  <td className="py-2 text-ink">{row.department}</td>
                  <td className="py-2 text-right text-ink-soft">
                    {row.headcount}
                  </td>
                  <td className="py-2 text-right font-[family-name:var(--font-mono)] text-ink">
                    {fmt(row.monthlyCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {error && !challenge ? (
          <p className="mt-3 text-sm font-medium text-signal-ink" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {/* Expense approvals */}
      <section className="rounded-xl border border-line bg-card p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink font-[family-name:var(--font-display)]">
          Expense reports
        </h2>
        <p className="text-sm text-ink-soft">
          Pending employee expenses. Approving is step-up protected
          {canApprove ? "." : " and limited to managers/admins."}
        </p>

        <ul className="mt-4 divide-y divide-line">
          {expenses.map((exp) => {
            const ref = approved[exp.id];
            return (
              <li
                key={exp.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {exp.category}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {exp.submitter} · {exp.submitted} ·{" "}
                    <span className="font-[family-name:var(--font-mono)]">
                      {exp.id}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-[family-name:var(--font-mono)] text-ink">
                    {fmt(exp.amountCents)}
                  </span>
                  {ref ? (
                    <span
                      title={`Reference ${ref}`}
                      className="rounded-full bg-verified-soft px-3 py-1 text-xs font-semibold text-verified"
                    >
                      Approved
                    </span>
                  ) : (
                    <button
                      onClick={() => begin("approve-expense", exp.id)}
                      disabled={!canApprove || !!busy}
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-ink disabled:opacity-50"
                    >
                      {busy === exp.id ? "Checking…" : "Approve"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
