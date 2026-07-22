import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import BadgeCard from "@/components/BadgeCard";
import { getSession } from "@/lib/session";
import { primaryRoleBadge, isAdmin, canApprove } from "@/lib/roles";
import { ORG_TREE, demoProfileFor, departmentAccent } from "@/lib/org";

/**
 * The signed-in employee's home. The badge on the left is the app's signature
 * visual element; everything on it that matters for authorization — the role
 * chip — comes from the verified access-token `roles` claim (see lib/session.ts).
 * Company/department/employee-id are demo metadata (see lib/org.ts), NOT live
 * FusionAuth Group lookups, and the page says so.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/login?redirect_uri=/dashboard");

  const profile = demoProfileFor({
    userId: session.userId,
    roles: session.roles,
  });
  const roleBadge = primaryRoleBadge(session.roles);
  const accent = departmentAccent(profile.department);
  const company = ORG_TREE.name;

  const shortcuts = [
    {
      href: "/directory",
      title: "Org directory",
      desc: "Walk the Company → Department → Resource entity tree and see your effective access.",
      show: true,
    },
    {
      href: "/approvals",
      title: "Approvals",
      desc: canApprove(session.roles)
        ? "View payroll and approve expenses — each re-checks your identity with step-up auth."
        : "View payroll with step-up auth. Approving expenses needs a manager/admin role.",
      show: true,
    },
    {
      href: "/admin",
      title: "Admin console",
      desc: "Team roster and the Tenant Manager self-service SSO story.",
      show: isAdmin(session.roles),
    },
    {
      href: "/settings",
      title: "Account settings",
      desc: "Manage your profile, password, and two-factor methods in FusionAuth.",
      show: true,
    },
  ].filter((s) => s.show);

  return (
    <AppShell session={session}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        {/* Welcome + role explainer + shortcuts */}
        <div className="order-2 lg:order-1">
          <p className="text-sm font-medium uppercase tracking-wide text-ink-soft">
            {profile.roleTitle}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink font-[family-name:var(--font-display)]">
            Welcome back, {session.name?.split(" ")[0] ?? "there"}.
          </h1>
          <p className="mt-2 max-w-xl text-ink-soft">
            You signed in through {company}&rsquo;s enterprise SSO — no
            FusionWorks password involved. Your role below is read from the
            verified access token&rsquo;s <code className="font-[family-name:var(--font-mono)] text-sm text-ink">roles</code>{" "}
            claim, which FusionAuth populates from your group membership.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {shortcuts.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="group rounded-xl border border-line bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <p className="font-semibold text-ink group-hover:text-brand-ink">
                  {s.title}
                </p>
                <p className="mt-1 text-sm text-ink-soft">{s.desc}</p>
              </Link>
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-dashed border-line bg-card/60 p-4 text-sm text-ink-soft">
            <span className="font-semibold text-ink">Demo note:</span> department
            and employee number are app metadata derived for the demo — group
            membership isn&rsquo;t on the JWT by default. Only your{" "}
            <span className="font-semibold text-ink">role</span> is authoritative,
            straight from the verified token.
          </div>
        </div>

        {/* Signature: the ID badge */}
        <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
          <BadgeCard
            name={session.name ?? "Employee"}
            email={session.email}
            company={company}
            department={profile.department}
            employeeId={profile.employeeId}
            roleBadge={roleBadge}
            accent={accent}
          />
        </div>
      </div>
    </AppShell>
  );
}
