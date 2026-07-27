import { cookies } from "next/headers";
import { createHash } from "crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import type { AccessToken } from "@fusionauth/typescript-client";
import { verifyAccessToken, verifyIdToken, resolveGroupNames } from "@/lib/fusionauth";
import { rolesFromClaims, groupIdsFromClaims } from "@/lib/roles";

/**
 * InFusion Works keeps ONE encrypted, httpOnly session cookie — not a database
 * session store, and (unlike FusionBank) not the react-sdk's multi-cookie
 * contract. The OAuth tokens are sealed inside it with `jose`'s `EncryptJWT`
 * (dir + A256GCM) using a key derived from SESSION_SECRET, so the cookie is
 * opaque to the browser.
 *
 * Encryption stops tampering/reading of the cookie, but identity is still only
 * trusted after the access token inside it is verified against FusionAuth's
 * JWKS on every read (see getSession -> verifyAccessToken). An expired or
 * revoked-key token therefore reads as logged-out even though the cookie
 * decrypts fine. Roles come off that same verified access token.
 */

const SESSION_COOKIE = "fw_session";

// The cookie can live as long as the refresh token; the real expiry gate is the
// access token's own JWT `exp`, re-checked on every getSession().
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
}

export interface Session {
  userId: string;
  email?: string;
  name?: string;
  roles: string[];
  /**
   * The user's FusionAuth Group membership UUIDs, read from the access token's
   * `groupIds` claim (populated by fusionauth/lambdas/jwt-populate.js). Empty
   * when the lambda isn't assigned to the application.
   */
  groupIds: string[];
  /**
   * Display names for `groupIds`, resolved from the Group API and cached (see
   * lib/fusionauth.ts `resolveGroupNames`). Empty when there are no memberships,
   * the lambda isn't assigned, or resolution failed — never blocks sign-in.
   */
  groups: string[];
  /** The user's FusionAuth tenant, off the access token's `tid` claim. */
  tenantId?: string;
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
}

/** 32-byte AES key derived from SESSION_SECRET (any length secret works). */
function sessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Missing SESSION_SECRET. Copy .env.local.example to .env.local and fill it in."
    );
  }
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

function cookieBase() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/**
 * Seals the token response into the encrypted session cookie. Called by the
 * /api/auth/callback route. Works inside a Route Handler because the
 * `next/headers` cookie store is mutable there and attaches to the response.
 */
export async function setSession(tokens: AccessToken) {
  const payload: SessionPayload = {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
  };

  const jwe = await new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .encrypt(sessionKey());

  const store = await cookies();
  store.set(SESSION_COOKIE, jwe, cookieBase());
}

/**
 * Decrypts the session cookie, then verifies the enclosed access token against
 * JWKS. Returns null (logged-out) for a missing/tampered/expired session.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  let payload: SessionPayload;
  try {
    const decrypted = await jwtDecrypt(raw, sessionKey());
    payload = decrypted.payload as unknown as SessionPayload;
  } catch {
    return null; // tampered, wrong key, or the cookie's own exp elapsed
  }
  if (!payload.accessToken) return null;

  let claims;
  try {
    // The access token is the authoritative credential; verify its signature,
    // issuer, and audience before trusting anything (roles included).
    claims = await verifyAccessToken(payload.accessToken);
  } catch {
    return null; // expired, tampered, or signed with a rotated key
  }

  const roles = rolesFromClaims(claims);
  // Group membership ids, if the JWT Populate lambda is putting them on the
  // access token. Resolve their display names via the cached Group-API lookup —
  // wrapped so a lookup hiccup degrades to "no groups" instead of logging the
  // user out. Empty when there are no memberships or the lambda isn't assigned.
  const groupIds = groupIdsFromClaims(claims);
  let groups: string[] = [];
  if (groupIds.length > 0) {
    try {
      groups = await resolveGroupNames(groupIds);
    } catch {
      groups = [];
    }
  }
  // FusionAuth stamps the tenant id on the access token as the `tid` claim.
  const tenantId = typeof claims.tid === "string" ? claims.tid : undefined;

  // Prefer the id_token for display claims (given_name etc. aren't always on the
  // access token); fall back to whatever the access token carries.
  let email = claims.email;
  let name: string | undefined =
    claims.name || claims.given_name || claims.preferred_username;
  if (payload.idToken) {
    try {
      const idClaims = await verifyIdToken(payload.idToken);
      email = idClaims.email ?? email;
      name =
        idClaims.name ||
        idClaims.given_name ||
        idClaims.preferred_username ||
        idClaims.email ||
        name;
    } catch {
      // Ignore a bad id_token; the access token already authenticated us.
    }
  }

  return {
    userId: claims.sub,
    email,
    name: name ?? email,
    roles,
    groupIds,
    groups,
    tenantId,
    accessToken: payload.accessToken,
    idToken: payload.idToken,
    refreshToken: payload.refreshToken,
  };
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The cookie whose presence proxy.ts uses as a cheap signed-in check. */
export const sessionCookieName = SESSION_COOKIE;
