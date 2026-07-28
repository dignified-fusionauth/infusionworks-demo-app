import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  FusionAuthClient,
  MultiFactorAction,
  Sort,
  type AccessToken,
  type User,
} from "@fusionauth/typescript-client";
import type { EntityGrant as DemoEntityGrant, Permission } from "@/lib/org";

/**
 * All the FusionAuth wiring for InFusion Works lives in this one file, so that
 * during a demo you can point to a single place and walk through exactly what
 * talks to FusionAuth and when.
 *
 * Server-side calls go through the official `@fusionauth/typescript-client`
 * (`FusionAuthClient`). There is NO browser SDK — the front end only ever hits
 * this app's own /api/auth/* routes, which call into this module.
 *
 * The concerns handled here, on purpose kept separate:
 *   1. Authorization Code + PKCE against the hosted login, with per-company SSO
 *      deep-linking via `idp_hint` / `login_hint` (the B2B2E enterprise-SSO story).
 *   2. Two-Factor "status" + "login" APIs -> step-up auth for viewing payroll
 *      and approving expenses. App-driven, because only InFusion Works knows which
 *      actions are sensitive.
 *   3. JWKS verification of the id_token / access_token, so we never trust
 *      unchecked claims. (The typescript-client doesn't verify JWT signatures,
 *      so we keep doing that with `jose`.)
 *   4. Entity Management reads (grants) for the org directory. FusionAuth does
 *      NOT auto-cascade permissions across a hierarchy — see /directory.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.local.example to .env.local and fill it in.`
    );
  }
  return value;
}

export const fusionAuthConfig = {
  get baseUrl() {
    return required("FUSIONAUTH_URL").replace(/\/$/, "");
  },
  get tenantId() {
    return process.env.FUSIONAUTH_TENANT_ID || undefined;
  },
  get clientId() {
    return required("FUSIONAUTH_CLIENT_ID");
  },
  get clientSecret() {
    return required("FUSIONAUTH_CLIENT_SECRET");
  },
  get apiKey() {
    return required("FUSIONAUTH_API_KEY");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get appBaseUrl() {
    return (process.env.APP_BASE_URL || "http://localhost:3000").replace(
      /\/$/,
      ""
    );
  },
};

/** The OAuth scope InFusion Works requests. `offline_access` gets us a refresh token. */
export const OAUTH_SCOPE = "openid offline_access email profile";

/** The redirect_uri handed to FusionAuth's /oauth2/authorize — our callback route. */
export const oauthRedirectUri = () =>
  `${fusionAuthConfig.appBaseUrl}/api/auth/callback`;

/**
 * One shared client. The API key authorizes the server-only Two-Factor and
 * Entity calls; the OAuth token/userinfo calls authenticate with the
 * code/refresh-token/access-token instead, which the client handles per-method.
 */
let client: FusionAuthClient | null = null;
function faClient(): FusionAuthClient {
  if (!client) {
    client = new FusionAuthClient(
      fusionAuthConfig.apiKey,
      fusionAuthConfig.baseUrl,
      fusionAuthConfig.tenantId
    );
  }
  return client;
}

// ---------------------------------------------------------------------------
// 1. Authorization Code + PKCE  (+ per-company SSO deep-linking)
// ---------------------------------------------------------------------------

/** Well-known OIDC discovery document endpoint for this tenant. */
function wellKnownUrl() {
  const tenantSegment = fusionAuthConfig.tenantId
    ? `/${fusionAuthConfig.tenantId}`
    : "";
  return `${fusionAuthConfig.baseUrl}/.well-known/openid-configuration${tenantSegment}`;
}

/**
 * Builds the URL that starts the hosted-login redirect. Hand-built because
 * front-channel authorize URLs are browser redirects, not API calls.
 *
 * The B2B2E hooks:
 *   - `idpHint`   -> `idp_hint=<identity-provider-id>`: skip FusionAuth's hosted
 *     IdP picker and go straight to one company's SSO. This is what each company
 *     button on the landing page uses.
 *   - `loginHint` -> `login_hint=<email-or-domain>`: match against an IdP's
 *     configured managed domains and route automatically — the "just type your
 *     work email" alternative. (Not supported for SAML v2 IdP-Initiated or HYPR.)
 *   - `tenantId`  -> `tenantId=<id>`: pin the tenant when passed explicitly.
 */
export function buildAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  idpHint?: string;
  loginHint?: string;
  tenantId?: string;
}) {
  const url = new URL(`${fusionAuthConfig.baseUrl}/oauth2/authorize`);
  url.searchParams.set("client_id", fusionAuthConfig.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", oauthRedirectUri());
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const tenantId = opts.tenantId || fusionAuthConfig.tenantId;
  if (tenantId) url.searchParams.set("tenantId", tenantId);
  if (opts.idpHint) url.searchParams.set("idp_hint", opts.idpHint);
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);

  return url.toString();
}

/**
 * A FusionAuth client with NO tenant header pinned, for INSTANCE-LEVEL reads
 * across tenants.
 *
 * The shared faClient() sends `X-FusionAuth-TenantId: <configured default>` on
 * every request, which makes a read of an object living in ANOTHER tenant (a
 * company's tenant-scoped IdP) come back 404. Instance-level objects can be read
 * without a tenant, so we drop the header here. A non-tenant-scoped API key can
 * then read objects in any tenant. (This is NOT for OAuth token calls — those
 * need the specific login tenant; see oauthClient.)
 */
function untenantedClient(): FusionAuthClient {
  return new FusionAuthClient(fusionAuthConfig.apiKey, fusionAuthConfig.baseUrl);
}

/**
 * A FusionAuth client scoped to a SPECIFIC tenant, for the OAuth token calls.
 *
 * Because InFusion Works is a Universal Application, the OAuth token endpoints
 * (/oauth2/token, refresh, /oauth2/userinfo) REQUIRE a tenant — omitting it
 * errors `missing_tenant_id`, and pinning the wrong one (the shared client's
 * default) errors `invalid_grant`. The right tenant is the one the login ran in,
 * carried from the authorize step (the callback reads it from a short-lived
 * cookie). Falls back to the configured default only if that's somehow absent.
 */
function oauthClient(tenantId?: string): FusionAuthClient {
  return new FusionAuthClient(
    fusionAuthConfig.apiKey,
    fusionAuthConfig.baseUrl,
    tenantId || fusionAuthConfig.tenantId
  );
}

/**
 * Resolves the tenant a login must target, from the per-company Identity
 * Provider named by `idp_hint`.
 *
 * InFusion Works signs in through a Universal Application — one `client_id`
 * shared across every tenant. A universal app is NOT bound to a tenant, so its
 * `application.tenantId` is useless here, and FusionAuth REQUIRES `tenantId` on
 * the authorize URL to know which tenant the user is logging into (there is no
 * tenant discovery for universal apps). The per-company tenant comes from the
 * company's tenant-scoped Identity Provider, which carries its owning tenant as
 * the top-level `tenantId` on `GET /api/identity-provider/{id}` (FusionAuth
 * 1.62.0+). We read it there and feed it into buildAuthorizeUrl.
 *
 * The lookup uses an un-pinned client on purpose: the shared faClient() pins the
 * configured default tenant via X-FusionAuth-TenantId, which makes reading an
 * IdP scoped to a DIFFERENT tenant come back 404 — the silent failure that made
 * this fall back to the default tenant before.
 *
 * Cached per IdP id (stable config), so we hit FusionAuth at most once per IdP.
 * Returns undefined when the lookup fails or the IdP is global (no owning tenant
 * on the object — a global IdP would need an idp→tenant mapping maintained
 * externally); callers then fall back to the configured FUSIONAUTH_TENANT_ID.
 */
const idpTenantCache = new Map<string, string>();
export async function getTenantIdForIdp(
  idpId: string
): Promise<string | undefined> {
  if (!idpId) return undefined;
  const cached = idpTenantCache.get(idpId);
  if (cached) return cached;
  try {
    const res = await untenantedClient().retrieveIdentityProvider(idpId);
    const tid = res.response.identityProvider?.tenantId;
    if (typeof tid === "string" && tid) {
      idpTenantCache.set(idpId, tid);
      return tid;
    }
  } catch {
    // fall through to undefined -> caller uses the configured default tenant
  }
  return undefined;
}

/**
 * Email-based Identity Provider auto-discovery. Given a work email (or bare
 * domain), finds which Identity Provider owns that email domain and returns its
 * `id` (for `idp_hint`) and owning `tenantId` (required on the Universal
 * Application's authorize URL).
 *
 * The mapping is NOT hardcoded in this app — it's read live from each IdP's
 * "Managed Domains" (`domains`) in FusionAuth. Add or change a company's domains
 * in FusionAuth and the work-email form routes correctly with no code change.
 *
 * Why we DON'T use `GET /api/identity-provider/lookup?domain=…`: that endpoint
 * only resolves instance/default-tenant IdPs. In this B2B2E setup every customer
 * IdP is TENANT-SCOPED (each carries its own `tenantId`), and the lookup endpoint
 * 404s for those — which silently dropped every email back to the default login.
 * Instead we list all IdPs (un-pinned client, so we see IdPs across every tenant)
 * and match the domain against each IdP's `domains` array ourselves, which also
 * hands us the owning `tenantId` off the IdP object.
 *
 * The domain→IdP map is cached with a short TTL so a burst of logins costs at
 * most one list call per window; a domain with no owning IdP returns undefined
 * so the caller falls back to a plain `login_hint` on the default tenant.
 */
interface IdpDomainMatch {
  idpId: string;
  tenantId?: string;
}

const IDP_DOMAIN_TTL_MS =
  Number(process.env.IDP_DOMAIN_TTL_MS) || 5 * 60 * 1000; // 5m
/** Shorter cooldown after a failed refresh so an outage doesn't spawn a call per login. */
const IDP_DOMAIN_NEGATIVE_TTL_MS = 30 * 1000; // 30s
let idpDomainMap: Map<string, IdpDomainMatch> | null = null;
let idpDomainMapExpiresAt = 0;
let idpDomainMapInflight: Promise<Map<string, IdpDomainMatch>> | null = null;

async function getIdpDomainMap(): Promise<Map<string, IdpDomainMatch>> {
  if (idpDomainMap && idpDomainMapExpiresAt > Date.now()) return idpDomainMap;
  if (idpDomainMapInflight) return idpDomainMapInflight;

  idpDomainMapInflight = (async () => {
    try {
      const res = await untenantedClient().retrieveIdentityProviders();
      const idps = res.response.identityProviders ?? [];
      const map = new Map<string, IdpDomainMatch>();
      for (const idp of idps) {
        // `enabled` defaults to true when absent; skip only when explicitly off.
        if (idp.enabled === false || !idp.id) continue;
        // `domains` (Managed Domains) isn't on the base type but is present at
        // runtime on the concrete IdP JSON.
        const domains = (idp as { domains?: unknown }).domains;
        if (!Array.isArray(domains)) continue;
        for (const d of domains) {
          if (typeof d === "string" && d.trim()) {
            map.set(d.trim().toLowerCase(), {
              idpId: idp.id,
              tenantId: idp.tenantId,
            });
          }
        }
      }
      idpDomainMap = map;
      idpDomainMapExpiresAt = Date.now() + IDP_DOMAIN_TTL_MS;
      return map;
    } catch {
      // Serve the last good map (stale) if we have one, else an empty map, and
      // back off for a short window so a FusionAuth outage under login traffic
      // doesn't fire retrieveIdentityProviders() on every request.
      idpDomainMap = idpDomainMap ?? new Map<string, IdpDomainMatch>();
      idpDomainMapExpiresAt = Date.now() + IDP_DOMAIN_NEGATIVE_TTL_MS;
      return idpDomainMap;
    } finally {
      idpDomainMapInflight = null;
    }
  })();

  return idpDomainMapInflight;
}

export async function lookupIdpByEmail(
  emailOrDomain: string
): Promise<IdpDomainMatch | undefined> {
  const raw = emailOrDomain.trim().toLowerCase();
  const domain = raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : raw;
  if (!domain) return undefined;
  const map = await getIdpDomainMap();
  return map.get(domain);
}

/**
 * Logout URL to use because self-service account management is enabled.
 *
 * Since FusionAuth 1.45.0 the hosted self-service account pages (/account/*,
 * which we link to via `accountManagementUrl` / `twoFactorManagementUrl`) run
 * on their OWN session — separate from both this app's session and the
 * FusionAuth SSO session. Hitting /oauth2/logout alone leaves that account
 * session alive, so a user could still reach the account pages after "logging
 * out". Ending it requires the dedicated /account/logout endpoint, which needs
 * `client_id` to know which application's self-service session to clear.
 *
 * `client_id` is the ONLY parameter to send. Verified against this instance:
 * /account/logout ends the account session, then chains into /oauth2/logout
 * (ending the SSO session too — single logout) and finally redirects to the
 * application's configured "Logout URL" in the FusionAuth admin (set that to
 * this app's base URL per environment; that's what lands the user back here).
 *
 * Do NOT add a `post_logout_redirect_uri` here: /account/logout rejects a
 * target that isn't a registered redirect URL and then skips the logout
 * entirely, leaving the account session alive.
 * See https://github.com/FusionAuth/fusionauth-issues/issues/2298
 *
 * `tenantId` IS required whenever the instance has more than one tenant:
 * without it the logout chain can't resolve which tenant's SSO session to end
 * and FusionAuth rejects the request with `missing_tenant_id`. `client_id`
 * alone isn't always enough to disambiguate. Pass the signed-in user's tenant
 * (the access token's `tid` claim — see lib/session.ts); fall back to the
 * configured FUSIONAUTH_TENANT_ID. It propagates through to /oauth2/logout.
 */
export function buildAccountLogoutUrl(tenantId?: string) {
  const url = new URL(`${fusionAuthConfig.baseUrl}/account/logout`);
  url.searchParams.set("client_id", fusionAuthConfig.clientId);
  const tid = tenantId || fusionAuthConfig.tenantId;
  if (tid) url.searchParams.set("tenantId", tid);
  return url.toString();
}

/**
 * Hosted self-service account management pages (FusionAuth's own UI).
 * FusionAuth needs `client_id` to know which application's account page to
 * render — without it, it bounces to the instance root — so include it.
 */
export function accountManagementUrl() {
  const url = new URL(`${fusionAuthConfig.baseUrl}/account/edit`);
  url.searchParams.set("client_id", fusionAuthConfig.clientId);
  return url.toString();
}

/** The MFA-methods page within FusionAuth's hosted self-service account UI. */
export function twoFactorManagementUrl() {
  const url = new URL(`${fusionAuthConfig.baseUrl}/account/two-factor/`);
  url.searchParams.set("client_id", fusionAuthConfig.clientId);
  return url.toString();
}

/**
 * Deep link for the enterprise self-service SSO story on the /admin page. Tenant
 * Manager (FusionAuth 1.65.0+) is where the enterprise CUSTOMER's own IT admin
 * configures their SAML/OIDC connection — entirely inside FusionAuth's hosted
 * admin UI, nothing InFusion Works builds. We only link out to it as a demo talking
 * point: `idp_hint`/`login_hint` is the runtime half (what this app uses), Tenant
 * Manager is the setup half the customer's IT team does themselves.
 *
 * The link opens `<FUSIONAUTH_URL>/tenant-manager/?tenantId=<tenantId>`, pinned to
 * the signed-in admin's own tenant (`tid` claim off their access token — see
 * lib/session.ts) so they land straight on their tenant's connections. Falls back
 * to the configured tenant when none is passed. Set FUSIONAUTH_TENANT_MANAGER_URL
 * to override the base if your instance exposes Tenant Manager elsewhere.
 */
export function tenantManagerUrl(tenantId?: string): string {
  const base =
    process.env.FUSIONAUTH_TENANT_MANAGER_URL?.trim() ||
    `${fusionAuthConfig.baseUrl}/tenant-manager/`;
  const url = new URL(base);
  const tid = tenantId || fusionAuthConfig.tenantId;
  if (tid) url.searchParams.set("tenantId", tid);
  return url.toString();
}

// ---------------------------------------------------------------------------
// User search (the admin team roster)
// ---------------------------------------------------------------------------

/** One user in the tenant, flattened for the /admin roster. */
export interface TenantUser {
  id: string;
  name: string;
  email?: string;
  /** InFusion Works application roles this user holds (empty if unregistered). */
  roles: string[];
}

/** The InFusion Works app roles a user holds, read off their registration. */
function appRolesForUser(user: User): string[] {
  const reg = (user.registrations ?? []).find(
    (r) => r.applicationId === fusionAuthConfig.clientId
  );
  return (reg?.roles ?? []).filter(
    (r): r is string => typeof r === "string" && r !== ""
  );
}

/**
 * Lists the users in a tenant for the admin roster, via the User Search API
 * (`GET /api/user/search?queryString=*`). Scoped to `tenantId` — the signed-in
 * admin's own tenant — by pinning the X-FusionAuth-TenantId header on a
 * tenant-scoped client, so an instance with multiple tenants only returns this
 * tenant's people.
 *
 * Returns `null` (not an empty array) when the search can't run — search engine
 * not configured (User Search needs the Elasticsearch/OpenSearch backend), or
 * the API key lacks the scope — so /admin can tell "no users" apart from "not
 * available" and fall back to the mock roster with an honest banner.
 */
export async function searchTenantUsers(
  tenantId?: string
): Promise<TenantUser[] | null> {
  const tid = tenantId || fusionAuthConfig.tenantId;
  // A fresh, tenant-scoped client rather than mutating the shared singleton,
  // whose tenant would otherwise leak across concurrent requests.
  const scoped = new FusionAuthClient(
    fusionAuthConfig.apiKey,
    fusionAuthConfig.baseUrl,
    tid
  );

  try {
    const res = await scoped.searchUsersByQuery({
      search: {
        queryString: "*",
        sortFields: [{ name: "email", order: Sort.asc }],
      },
    });
    const users = res.response.users ?? [];
    return users
      .map((u) => ({
        id: u.id ?? "",
        name:
          u.fullName ||
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.email ||
          "Unnamed user",
        email: u.email,
        roles: appRolesForUser(u),
      }))
      .filter((u) => u.id !== "");
  } catch {
    return null;
  }
}

/**
 * Exchanges the authorization code for tokens (PKCE). Server-side only.
 *
 * `tenantId` MUST be the tenant the login ran in (a universal-app /oauth2/token
 * call requires it, and it has to match the code's tenant). The callback carries
 * it over from the authorize step. See oauthClient.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  tenantId?: string
): Promise<AccessToken> {
  const res = await oauthClient(
    tenantId
  ).exchangeOAuthCodeForAccessTokenUsingPKCE(
    code,
    fusionAuthConfig.clientId,
    fusionAuthConfig.clientSecret,
    oauthRedirectUri(),
    codeVerifier
  );
  return res.response;
}

/**
 * Trades a refresh token for a fresh access token. Server-side only. `tenantId`
 * must be the user's own tenant, for the same reason as exchangeCodeForTokens.
 */
export async function refreshAccessToken(
  refreshToken: string,
  tenantId?: string
): Promise<AccessToken> {
  const res = await oauthClient(tenantId).exchangeRefreshTokenForAccessToken(
    refreshToken,
    fusionAuthConfig.clientId,
    fusionAuthConfig.clientSecret,
    OAUTH_SCOPE,
    ""
  );
  return res.response;
}

/**
 * Proxies FusionAuth's /oauth2/userinfo for the given access token. `tenantId`
 * must be the token's own tenant (universal-app requirement).
 */
export async function fetchUserInfo(
  accessToken: string,
  tenantId?: string
): Promise<Record<string, unknown>> {
  const res = await oauthClient(tenantId).retrieveUserInfoFromAccessToken(
    accessToken
  );
  return res.response as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// JWKS verification
// ---------------------------------------------------------------------------

/**
 * The tenant's Issuer and its JWKS endpoint both come from the OIDC discovery
 * document, NOT from the base URL. They differ whenever you reach FusionAuth on
 * a custom domain while the tenant Issuer is still the default. Fetch discovery
 * once and cache it so verification uses the real values.
 */
interface OidcDiscovery {
  issuer: string;
  jwks_uri: string;
}

let discovery: Promise<OidcDiscovery> | null = null;
function getDiscovery(): Promise<OidcDiscovery> {
  if (!discovery) {
    discovery = (async () => {
      const res = await fetch(wellKnownUrl());
      if (!res.ok) {
        discovery = null; // don't cache failures
        throw new Error(`OIDC discovery failed (${res.status}).`);
      }
      const doc = (await res.json()) as OidcDiscovery;
      return { issuer: doc.issuer, jwks_uri: doc.jwks_uri };
    })();
  }
  return discovery;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function getJwks() {
  if (!jwks) {
    const { jwks_uri } = await getDiscovery();
    jwks = createRemoteJWKSet(new URL(jwks_uri));
  }
  return jwks;
}

export interface FusionAuthUserClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  /** Present on the ACCESS token (incl. Group-derived roles); absent on id_token. */
  roles?: string[];
  /**
   * The user's FusionAuth Group membership UUIDs, put on the access token by the
   * JWT Populate lambda (fusionauth/lambdas/jwt-populate.js). The lambda emits
   * IDs only; human-readable names are resolved app-side via `resolveGroupNames`
   * (cached). Absent unless that lambda is assigned to the application.
   */
  groupIds?: string[];
  /** Allow reading any other claim without an unsafe cast at the call site. */
  [claim: string]: unknown;
}

/** Verifies the id_token's signature + issuer/audience before trusting it. */
export async function verifyIdToken(
  idToken: string
): Promise<FusionAuthUserClaims> {
  const [keys, { issuer }] = await Promise.all([getJwks(), getDiscovery()]);
  const { payload } = await jwtVerify(idToken, keys, {
    issuer,
    audience: fusionAuthConfig.clientId,
  });
  return payload as unknown as FusionAuthUserClaims;
}

/**
 * Verifies the access_token the same way. Used server-side to turn the encrypted
 * session cookie's stored access token back into trusted identity + role claims
 * (see lib/session.ts). FusionAuth access tokens are JWTs whose `aud` is the
 * application/client id.
 */
export async function verifyAccessToken(
  accessToken: string
): Promise<FusionAuthUserClaims> {
  const [keys, { issuer }] = await Promise.all([getJwks(), getDiscovery()]);
  const { payload } = await jwtVerify(accessToken, keys, {
    issuer,
    audience: fusionAuthConfig.clientId,
  });
  return payload as unknown as FusionAuthUserClaims;
}

// ---------------------------------------------------------------------------
// 2. Step-up auth (Two-Factor status + login), API-key driven
// ---------------------------------------------------------------------------

export interface TwoFactorMethod {
  id: string;
  method: string;
  email?: string;
  mobilePhone?: string;
}

export interface TwoFactorStatusResult {
  challengeRequired: boolean;
}

export interface StepUpChallenge {
  twoFactorId: string;
  methods: TwoFactorMethod[];
}

/**
 * Asks FusionAuth whether this user needs to complete MFA before performing
 * `action`. This is the step-up-auth pattern from the FusionAuth docs:
 * https://fusionauth.io/docs/lifecycle/authenticate-users/multi-factor-authentication#step-up-auth
 *
 * FusionAuth returns HTTP 242 when a challenge is required and 200 when it
 * isn't; both are 2xx, so we branch on `statusCode`.
 */
export async function checkTwoFactorStatus(opts: {
  userId: string;
  action: string;
  ipAddress?: string;
}): Promise<TwoFactorStatusResult> {
  const res = await faClient().retrieveTwoFactorStatusWithRequest({
    userId: opts.userId,
    applicationId: fusionAuthConfig.clientId,
    // `action` is the reserved FusionAuth value ("stepUp"); the app-specific
    // reason ("view-payroll" / "approve-expense") is context for the MFA
    // policy/lambda and rides in eventInfo.data instead.
    action: MultiFactorAction.stepUp,
    eventInfo: {
      data: { action: opts.action },
      ...(opts.ipAddress ? { ipAddress: opts.ipAddress } : {}),
    },
  });

  return { challengeRequired: res.statusCode === 242 };
}

/**
 * Starts the step-up challenge once /status has said one is required. Only
 * /start hands back the twoFactorId + enrolled methods; for message-based
 * methods (email/SMS) we then ask FusionAuth to deliver the code via /send.
 * TOTP/authenticator needs no send — the user reads the code from their app.
 */
export async function startTwoFactorChallenge(opts: {
  userId: string;
}): Promise<StepUpChallenge> {
  const startRes = await faClient().startTwoFactorLogin({
    userId: opts.userId,
    applicationId: fusionAuthConfig.clientId,
  });

  const twoFactorId = startRes.response.twoFactorId ?? "";
  const methods = (startRes.response.methods ?? []) as TwoFactorMethod[];

  const primary = methods[0];
  if (primary && (primary.method === "email" || primary.method === "sms")) {
    await faClient().sendTwoFactorCodeForLoginUsingMethod(twoFactorId, {
      methodId: primary.id,
    });
  }

  return { twoFactorId, methods };
}

/** Completes the step-up challenge with the code the user entered. */
export async function completeTwoFactorLogin(opts: {
  twoFactorId: string;
  code: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await faClient().twoFactorLogin({
      twoFactorId: opts.twoFactorId,
      code: opts.code,
    });
    return { success: true };
  } catch (err) {
    // The client rejects with a ClientResponse on non-2xx. 421 = bad code.
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 421) {
      return { success: false, error: "Incorrect code. Try again." };
    }
    return {
      success: false,
      error: `Verification failed (${statusCode ?? "unknown"}).`,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. Entity Management (grants) — the org directory demo
// ---------------------------------------------------------------------------

/** Narrows FusionAuth's free-form permission strings to the ones we model. */
function toDemoPermissions(raw: string[] | undefined): Permission[] {
  const out: Permission[] = [];
  for (const p of raw ?? []) {
    if (p === "view" || p === "edit") out.push(p);
  }
  return out;
}

/**
 * Every Entity grant held by one user, as `{ entityId, permissions }`. Returns
 * `null` (not an empty array) when the Entity Management API can't be used —
 * paid-plan feature not licensed, no entities seeded, or the API key lacks
 * entity scopes — so the /directory page can tell "no grants" apart from
 * "not available" and fall back to demo grants with an honest banner.
 */
export async function getGrantsForUser(
  userId: string
): Promise<DemoEntityGrant[] | null> {
  try {
    const res = await faClient().searchEntityGrants({ search: { userId } });
    const grants = res.response.grants ?? [];
    return grants
      .map((g) => ({
        entityId: g.entity?.id ?? "",
        permissions: toDemoPermissions(g.permissions),
      }))
      .filter((g) => g.entityId !== "");
  } catch {
    return null;
  }
}

/** All grants on one entity (who can do what to it). Null when unavailable. */
export async function getGrantsForEntity(
  entityId: string
): Promise<DemoEntityGrant[] | null> {
  try {
    const res = await faClient().searchEntityGrants({ search: { entityId } });
    const grants = res.response.grants ?? [];
    return grants
      .map((g) => ({
        entityId,
        permissions: toDemoPermissions(g.permissions),
      }))
      .filter((g) => g.permissions.length > 0);
  } catch {
    return null;
  }
}

/**
 * Upserts a User→Entity grant (the write half of the Entity demo, if you want
 * to grant access live from the admin UI). Idempotent per the Grant API.
 */
export async function upsertGrant(opts: {
  entityId: string;
  userId: string;
  permissions: string[];
}): Promise<void> {
  await faClient().upsertEntityGrant(opts.entityId, {
    grant: { userId: opts.userId, permissions: opts.permissions },
  });
}

// ---------------------------------------------------------------------------
// 4. Group name resolution — turns the access token's `groupIds` claim into
//    human-readable names, WITHOUT a groupId->name map in the lambda.
//
// The lambda (fusionauth/lambdas/jwt-populate.js) emits only stable group ids;
// we resolve names here via GET /api/group/{groupId}. Because getSession() runs
// on every protected request, a naive per-request fetch would hammer FusionAuth,
// so this layer is built to stay flat under load:
//
//   * TTL cache (module-level)  — the primary defense. Group names change rarely,
//     so a resolved name is reused across ALL requests for GROUP_NAME_TTL_MS,
//     collapsing thousands of page loads into ~1 API call per group per TTL.
//   * In-flight de-duplication  — when a hot entry expires and N concurrent
//     requests race to refill it, they share ONE in-flight promise instead of
//     firing N identical calls (prevents a cache-stampede spike).
//   * Negative caching          — a missing/deleted/forbidden id is remembered
//     (briefly) too, so a bad id can't trigger a fetch on every request.
//
// Group ids are globally-unique UUIDs, so we read with the un-pinned client
// (like getTenantIdForIdp): a non-tenant-locked API key resolves a group in ANY
// tenant by id, which is what B2B2E multi-tenant needs. Cache key is the id
// alone — no tenant needed.
// ---------------------------------------------------------------------------

/** How long a resolved (or missing) group name is trusted before re-fetching. */
const GROUP_NAME_TTL_MS = Number(process.env.GROUP_NAME_TTL_MS) || 60 * 60 * 1000; // 1h
/** Missing/forbidden ids are re-checked sooner so a fixed group appears quickly. */
const GROUP_NAME_NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5m

interface CachedGroupName {
  /** Resolved name, or null when the id is known-absent (negative cache). */
  name: string | null;
  expiresAt: number;
}

const groupNameCache = new Map<string, CachedGroupName>();
const groupNameInflight = new Map<string, Promise<string | null>>();

/**
 * Resolves ONE group id to its name, cache-first. Never throws — a lookup
 * failure caches `null` (so we don't retry every request) and the caller simply
 * drops that membership from the display list.
 */
export async function retrieveGroupName(groupId: string): Promise<string | null> {
  if (!groupId) return null;

  const cached = groupNameCache.get(groupId);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  // Coalesce concurrent misses for the same id onto a single request.
  const existing = groupNameInflight.get(groupId);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const res = await untenantedClient().retrieveGroup(groupId);
      const name = res.response.group?.name ?? null;
      groupNameCache.set(groupId, {
        name,
        expiresAt:
          Date.now() +
          (name ? GROUP_NAME_TTL_MS : GROUP_NAME_NEGATIVE_TTL_MS),
      });
      return name;
    } catch {
      // Deleted id, missing scope, or FusionAuth unreachable — negative-cache
      // briefly so one bad id doesn't fetch on every request.
      groupNameCache.set(groupId, {
        name: null,
        expiresAt: Date.now() + GROUP_NAME_NEGATIVE_TTL_MS,
      });
      return null;
    } finally {
      groupNameInflight.delete(groupId);
    }
  })();

  groupNameInflight.set(groupId, promise);
  return promise;
}

/**
 * Resolves the `groupIds` claim to a de-duplicated, order-preserving list of
 * group names, dropping any that can't be resolved. Distinct ids are fetched in
 * parallel but each is cache-guarded + de-duplicated by `retrieveGroupName`, so
 * the real cost is only the first-seen ids this TTL window.
 */
export async function resolveGroupNames(groupIds: string[]): Promise<string[]> {
  const unique = [...new Set(groupIds.filter(Boolean))];
  const names = await Promise.all(unique.map(retrieveGroupName));
  return names.filter((n): n is string => typeof n === "string" && n !== "");
}

