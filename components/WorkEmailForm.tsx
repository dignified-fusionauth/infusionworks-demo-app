/**
 * The "or enter your work email" fallback. A plain GET form to /api/auth/login,
 * so the typed email arrives as `?loginHint=…` and FusionAuth matches it against
 * an IdP's configured managed domains and routes automatically — no client JS
 * required. (login_hint isn't supported for SAML v2 IdP-Initiated or HYPR IdPs.)
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
