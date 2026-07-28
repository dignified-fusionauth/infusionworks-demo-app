/**
 * The "enter your work email" auto-discovery form. A plain GET form to
 * /api/auth/login, so the typed email arrives as `?loginHint=…` with no client
 * JS. Server-side (see lib/bff.ts -> startOAuthRedirect), the email's domain is
 * matched against each IdP's Managed Domains in FusionAuth (lib/fusionauth.ts ->
 * lookupIdpByEmail). On a match we deep-link straight to that company's SSO on
 * its own tenant; the domain→IdP mapping lives entirely in FusionAuth, not
 * hardcoded here. If no IdP owns the domain, the email is still passed through as
 * `login_hint` to the default hosted login page.
 */
export default function WorkEmailForm() {
  return (
    <form action="/api/auth/login" method="get" className="flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="redirect_uri" value="/dashboard" />
      <label className="sr-only" htmlFor="loginHint">
        Work email
      </label>
      <input
        id="loginHint"
        name="loginHint"
        type="email"
        required
        autoComplete="email"
        placeholder="you@yourcompany.com"
        className="flex-1 rounded-lg border border-line bg-card px-4 py-2.5 text-ink placeholder:text-ink-soft/70 focus:border-brand focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-lg bg-ink px-5 py-2.5 font-semibold text-white transition hover:bg-brand-ink"
      >
        Continue
      </button>
    </form>
  );
}
