import CompanyPicker from "@/components/CompanyPicker";
import WorkEmailForm from "@/components/WorkEmailForm";
import { resolveCompanies } from "@/lib/companies";

const ERRORS: Record<string, string> = {
  invalid_state: "That sign-in link expired. Please try again.",
  exchange_failed: "We couldn't complete sign-in. Please try again.",
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const companies = resolveCompanies();
  const { error } = await searchParams;
  const errorMessage = error ? (ERRORS[error] ?? "Sign-in failed.") : null;

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="border-b border-line bg-ink text-white">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:py-20">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-sm font-bold text-ink font-[family-name:var(--font-display)]"
              aria-hidden="true"
            >
              FW
            </span>
            <span className="text-base font-bold tracking-tight font-[family-name:var(--font-display)]">
              FusionWorks
            </span>
          </div>
          <h1 className="mt-8 max-w-2xl text-4xl font-bold leading-tight tracking-tight font-[family-name:var(--font-display)] sm:text-5xl">
            The people &amp; approvals hub for your whole company.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-white/70">
            Sign in with your company&rsquo;s single sign-on — Entra ID, Okta, or
            Google Workspace. No new password to remember.
          </p>
        </div>
      </section>

      {/* Company picker */}
      <section className="mx-auto max-w-5xl px-5 py-12">
        {errorMessage ? (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-signal/40 bg-signal-soft px-4 py-3 text-sm font-medium text-signal-ink"
          >
            {errorMessage}
          </div>
        ) : null}

        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Choose your company
        </h2>
        <p className="mt-1 text-ink-soft">
          Each button deep-links straight to that company&rsquo;s identity
          provider.
        </p>

        <div className="mt-6">
          <CompanyPicker companies={companies} />
        </div>

        {/* Work-email fallback */}
        <div className="mt-10 rounded-xl border border-line bg-card p-6">
          <h3 className="font-semibold text-ink">Not sure which one?</h3>
          <p className="mt-1 mb-4 text-sm text-ink-soft">
            Enter your work email and we&rsquo;ll route you to the right identity
            provider automatically.
          </p>
          <WorkEmailForm />
        </div>
      </section>
    </main>
  );
}
