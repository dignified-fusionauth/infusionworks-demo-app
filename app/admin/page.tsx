import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/roles";
import { tenantManagerUrl } from "@/lib/fusionauth";
import { demoTeam, departmentAccent, roleLabel } from "@/lib/org";

/**
 * Admin console. proxy.ts only checks that a session cookie is present, so the
 * actual role gate lives HERE, off the verified access-token `roles` claim: a
 * signed-in non-admin gets bounced to the dashboard rather than seeing this. The
 * roster is mock data; the real point is the Tenant Manager callout — the
 * self-service SSO setup story FusionWorks didn't have to build.
 */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/login?redirect_uri=/admin");
  if (!isAdmin(session.roles)) redirect("/dashboard");

  const tenantManager = tenantManagerUrl();

  return (
    <AppShell session={session}>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink font-[family-name:var(--font-display)]">
          Admin console
        </h1>
        <p className="mt-2 text-ink-soft">
          You see this because your access token carries the admin role. Group
          membership maps to that role in FusionAuth — no JWT Populate lambda
          required, since role claims ride on the access token automatically.
        </p>
      </div>

      {/* Team roster (mock) */}
      <section className="mt-8 overflow-hidden rounded-xl border border-line bg-card shadow-sm">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-bold text-ink font-[family-name:var(--font-display)]">
            Team members
          </h2>
          <p className="text-sm text-ink-soft">Mock roster for the demo.</p>
        </div>
        <ul className="divide-y divide-line">
          {demoTeam.map((person) => {
            const accent = departmentAccent(person.department);
            return (
              <li
                key={person.employeeId}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white font-[family-name:var(--font-display)]"
                    style={{ background: accent }}
                    aria-hidden="true"
                  >
                    {person.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{person.name}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {person.title} · {person.email}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className="hidden rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline"
                    style={{ background: `${accent}1a`, color: accent }}
                  >
                    {person.department}
                  </span>
                  <span className="text-sm font-semibold text-ink-soft">
                    {roleLabel(person.role)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Tenant Manager — the self-service enterprise SSO story */}
      <section className="mt-6 rounded-xl border border-line bg-brand-soft/50 p-5">
        <h2 className="font-bold text-ink font-[family-name:var(--font-display)]">
          Enterprise SSO setup — self-service
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          FusionWorks never built a screen for a customer to connect their own
          identity provider. Their IT admin does that themselves in FusionAuth&rsquo;s{" "}
          <strong className="text-ink">Tenant Manager</strong> (1.65.0+): they
          register their SAML/OIDC connection, and it immediately becomes an{" "}
          <code className="font-[family-name:var(--font-mono)] text-xs text-ink">
            idp_hint
          </code>{" "}
          target the landing page can deep-link to. Runtime half:{" "}
          <code className="font-[family-name:var(--font-mono)] text-xs text-ink">
            idp_hint
          </code>
          /
          <code className="font-[family-name:var(--font-mono)] text-xs text-ink">
            login_hint
          </code>{" "}
          (this app). Setup half: Tenant Manager (them).
        </p>
        <a
          href={tenantManager}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-ink"
        >
          Open FusionAuth Tenant Manager →
        </a>
      </section>
    </AppShell>
  );
}
