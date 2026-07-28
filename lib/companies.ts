/**
 * The demo companies that InFusion Works is "sold to". This is the B2B2E story:
 * InFusion Works is one product, but each customer company signs in through its
 * OWN identity provider (Entra ID / Okta / Google Workspace) or directory
 * (LDAP), never a InFusion Works-native password.
 *
 * The landing page maps over this array, so the number of companies is a config
 * change here, not a code change on the page. Most companies deep-link to their
 * own IdP via FusionAuth's `idp_hint` param (see buildAuthorizeUrl in
 * lib/fusionauth.ts) — clicking the button skips FusionAuth's hosted IdP picker
 * and lands the employee straight on their company's SSO.
 *
 * The IdP UUID itself is NOT hardcoded — it's read from an env var per company
 * (see .env.local.example). A company whose env var is empty renders as
 * "Not configured yet" rather than producing a broken authorize URL.
 *
 * A company can also have NO IdP — e.g. an LDAP connector, which FusionAuth
 * authenticates on the hosted login page itself (there is no `idp_hint` for a
 * connector). Such a company omits `idpEnvVar` and its card goes to the default
 * hosted login instead of an idp_hint deep-link.
 */

export interface Company {
  /** Stable slug used in URLs and as a React key. */
  id: string;
  /** Shown on the company's card. */
  displayName: string;
  /** Which SSO product this company's IT team connected (display label only). */
  ssoProvider: "Entra ID" | "Okta" | "Google Workspace" | "LDAP";
  /**
   * Name of the env var holding this company's FusionAuth Identity Provider
   * UUID. Kept as a reference (not the value) so the config is declarative and
   * the value stays server-side in the environment.
   *
   * Omit for a company that has NO IdP (e.g. an LDAP connector): FusionAuth
   * authenticates it on the hosted login page directly, so there's no idp_hint
   * to build — its card links to the default hosted login instead.
   */
  idpEnvVar?: string;
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
 * Four demo customers by default. Add or remove entries freely — the UI adapts.
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
  {
    id: "atlas",
    displayName: "Atlas LDAP Directory",
    ssoProvider: "LDAP",
    // No idpEnvVar: an LDAP connector has no Identity Provider UUID. FusionAuth
    // authenticates it on the hosted login page, so this card goes to the
    // default login rather than an idp_hint deep-link.
    emailDomain: "atlas.example",
    tagline: "On-prem directory services",
    accentColor: "#d9480f",
  },
];

export interface ResolvedCompany extends Company {
  /** The IdP UUID from the env var, or "" when this company has no IdP. */
  idpId: string;
  /**
   * How this card signs the employee in:
   *   - "idp":     deep-link to the company's IdP via `idp_hint` (needs `idpId`).
   *   - "default": no IdP (e.g. an LDAP connector) — go to the default hosted
   *                login, where FusionAuth authenticates the connector directly.
   */
  loginMode: "idp" | "default";
  /** True when the card's sign-in button should be enabled. */
  configured: boolean;
}

/**
 * Resolves a company for rendering. Reads env at call time (server-side) so a
 * value added to .env.local is picked up without a code change. Safe to call
 * during build with placeholder/empty env.
 *
 * Two shapes:
 *   - A company WITH `idpEnvVar` resolves its IdP UUID from the environment and
 *     is `configured` only when that value is present (an empty var renders as
 *     "Not configured yet" rather than a broken authorize URL).
 *   - A company WITHOUT `idpEnvVar` (e.g. an LDAP connector) has no IdP UUID; it
 *     signs in through the default hosted login and is always `configured`.
 */
export function resolveCompany(company: Company): ResolvedCompany {
  if (!company.idpEnvVar) {
    // No IdP (LDAP connector): default hosted login, always enabled.
    return { ...company, idpId: "", loginMode: "default", configured: true };
  }
  const idpId = (process.env[company.idpEnvVar] ?? "").trim();
  return { ...company, idpId, loginMode: "idp", configured: idpId.length > 0 };
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
