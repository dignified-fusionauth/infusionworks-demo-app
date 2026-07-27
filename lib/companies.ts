/**
 * The demo companies that InFusion Works is "sold to". This is the B2B2E story:
 * InFusion Works is one product, but each customer company signs in through its
 * OWN identity provider (Entra ID / Okta / Google Workspace), never a
 * InFusion Works-native password.
 *
 * The landing page maps over this array, so the number of companies is a config
 * change here, not a code change on the page. Each company deep-links to its own
 * IdP via FusionAuth's `idp_hint` param (see buildAuthorizeUrl in
 * lib/fusionauth.ts) — clicking a company button skips FusionAuth's hosted IdP
 * picker and lands the employee straight on their company's SSO.
 *
 * The IdP UUID itself is NOT hardcoded — it's read from an env var per company
 * (see .env.local.example). A company whose env var is empty renders as
 * "Not configured yet" rather than producing a broken authorize URL.
 */

export interface Company {
  /** Stable slug used in URLs and as a React key. */
  id: string;
  /** Shown on the company's card. */
  displayName: string;
  /** Which SSO product this company's IT team connected (display label only). */
  ssoProvider: "Entra ID" | "Okta" | "Google Workspace";
  /**
   * Name of the env var holding this company's FusionAuth Identity Provider
   * UUID. Kept as a reference (not the value) so the config is declarative and
   * the value stays server-side in the environment.
   */
  idpEnvVar: string;
  /**
   * The company's email domain. Used as placeholder/help text for the
   * "enter your work email" (login_hint) flow — a real employee would type
   * e.g. dana@northwind.example.
   */
  emailDomain: string;
  /** One-line flavor shown under the company name. */
  tagline: string;
  /**
   * Accent color (hex) for the company's card + badge band. Deliberately varied
   * so the landing grid reads like a set of distinct customers.
   */
  accentColor: string;
}

/**
 * Three demo customers by default. Add or remove entries freely — the UI adapts.
 * Keep one env var per company and document it in .env.local.example.
 */
export const companies: Company[] = [
  {
    id: "northwind",
    displayName: "Northwind Trading Co.",
    ssoProvider: "Entra ID",
    idpEnvVar: "FUSIONAUTH_IDP_ID_NORTHWIND",
    emailDomain: "northwind.example",
    tagline: "Global logistics & distribution",
    accentColor: "#3b5bdb",
  },
  {
    id: "vertex",
    displayName: "Vertex Robotics",
    ssoProvider: "Okta",
    idpEnvVar: "FUSIONAUTH_IDP_ID_VERTEX",
    emailDomain: "vertex.example",
    tagline: "Industrial automation systems",
    accentColor: "#0d9488",
  },
  {
    id: "meridian",
    displayName: "Meridian Health",
    ssoProvider: "Google Workspace",
    idpEnvVar: "FUSIONAUTH_IDP_ID_MERIDIAN",
    emailDomain: "meridian.example",
    tagline: "Regional care network",
    accentColor: "#7c3aed",
  },
];

export interface ResolvedCompany extends Company {
  /** The IdP UUID from the env var, or "" if unset. */
  idpId: string;
  /** True when idpId is present — gates whether the SSO button is enabled. */
  configured: boolean;
}

/**
 * Resolves a company's `idpEnvVar` against the current environment. Reads env at
 * call time (server-side) so a value added to .env.local is picked up without a
 * code change. Safe to call during build with placeholder/empty env — an unset
 * var simply yields `configured: false`.
 */
export function resolveCompany(company: Company): ResolvedCompany {
  const idpId = (process.env[company.idpEnvVar] ?? "").trim();
  return { ...company, idpId, configured: idpId.length > 0 };
}

/** Resolves every configured/unconfigured company for the landing grid. */
export function resolveCompanies(): ResolvedCompany[] {
  return companies.map(resolveCompany);
}

/** Looks up a single company by slug (e.g. from a query param), resolved. */
export function resolveCompanyById(id: string): ResolvedCompany | undefined {
  const company = companies.find((c) => c.id === id);
  return company ? resolveCompany(company) : undefined;
}
