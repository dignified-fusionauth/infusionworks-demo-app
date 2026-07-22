import type { ResolvedCompany } from "@/lib/companies";

/**
 * The "choose your company" grid. Each configured company deep-links to its own
 * IdP via /api/auth/login?idpHint=<idpId> (which becomes `idp_hint` on the
 * authorize URL, skipping FusionAuth's hosted IdP picker). A company with no
 * configured IdP UUID renders disabled with "Not configured yet" instead of
 * building a broken URL.
 */
export default function CompanyPicker({
  companies,
}: {
  companies: ResolvedCompany[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {companies.map((company) => {
        const href = `/api/auth/login?idpHint=${encodeURIComponent(
          company.idpId
        )}&redirect_uri=${encodeURIComponent("/dashboard")}`;

        const inner = (
          <>
            <span
              className="block h-1.5 w-full rounded-full"
              style={{ background: company.accentColor }}
              aria-hidden="true"
            />
            <div className="mt-4 flex-1">
              <h3 className="text-lg font-bold text-ink font-[family-name:var(--font-display)]">
                {company.displayName}
              </h3>
              <p className="mt-1 text-sm text-ink-soft">{company.tagline}</p>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: company.accentColor }}
                  aria-hidden="true"
                />
                {company.ssoProvider}
              </span>
              {company.configured ? (
                <span className="text-sm font-semibold text-brand-ink">
                  Sign in with SSO →
                </span>
              ) : (
                <span className="text-xs font-medium text-ink-soft">
                  Not configured yet
                </span>
              )}
            </div>
          </>
        );

        const cardBase =
          "flex flex-col rounded-xl border border-line bg-card p-5 text-left shadow-sm transition";

        return company.configured ? (
          <a
            key={company.id}
            href={href}
            className={`${cardBase} hover:-translate-y-0.5 hover:shadow-md focus-visible:-translate-y-0.5`}
          >
            {inner}
          </a>
        ) : (
          <div
            key={company.id}
            aria-disabled="true"
            title="Set this company's FusionAuth IdP UUID env var to enable SSO"
            className={`${cardBase} cursor-not-allowed opacity-60`}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
