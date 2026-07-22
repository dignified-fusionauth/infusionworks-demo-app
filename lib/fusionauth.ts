import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  FusionAuthClient,
  MultiFactorAction,
  type AccessToken,
} from "@fusionauth/typescript-client";
import type { EntityGrant as DemoEntityGrant, Permission } from "@/lib/org";

/**
 * All the FusionAuth wiring for FusionWorks lives in this one file, so that
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
 *      and approving expenses. App-driven, because only FusionWorks knows which
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

/** The OAuth scope FusionWorks requests. `offline_access` gets us a refresh token. */
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

export function buildLogoutUrl(postLogoutRedirectUri?: string) {
  const url = new URL(`${fusionAuthConfig.baseUrl}/oauth2/logout`);
  url.searchParams.set("client_id", fusionAuthConfig.clientId);
  url.searchParams.set(
    "post_logout_redirect_uri",
    postLogoutRedirectUri || fusionAuthConfig.appBaseUrl
  );
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
 * admin UI, nothing FusionWorks builds. We only link out to it as a demo talking
 * point: `idp_hint`/`login_hint` is the runtime half (what this app uses), Tenant
 * Manager is the setup half the customer's IT team does themselves. Defaults to
 * the instance root; set FUSIONAUTH_TENANT_MANAGER_URL to the exact self-service
 * URL your instance exposes.
 */
export function tenantManagerUrl(): string {
  const explicit = process.env.FUSIONAUTH_TENANT_MANAGER_URL?.trim();
  return (explicit || fusionAuthConfig.baseUrl).replace(/\/$/, "");
}

/** Exchanges the authorization code for tokens (PKCE). Server-side only. */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<AccessToken> {
  const res = await faClient().exchangeOAuthCodeForAccessTokenUsingPKCE(
    code,
    fusionAuthConfig.clientId,
    fusionAuthConfig.clientSecret,
    oauthRedirectUri(),
    codeVerifier
  );
  return res.response;
}

/** Trades a refresh token for a fresh access token. Server-side only. */
export async function refreshAccessToken(
  refreshToken: string
): Promise<AccessToken> {
  const res = await faClient().exchangeRefreshTokenForAccessToken(
    refreshToken,
    fusionAuthConfig.clientId,
    fusionAuthConfig.clientSecret,
    OAUTH_SCOPE,
    ""
  );
  return res.response;
}

/** Proxies FusionAuth's /oauth2/userinfo for the given access token. */
export async function fetchUserInfo(
  accessToken: string
): Promise<Record<string, unknown>> {
  const res = await faClient().retrieveUserInfoFromAccessToken(accessToken);
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
