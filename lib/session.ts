import { cookies } from "next/headers";
import { createHash } from "crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import type { AccessToken } from "@fusionauth/typescript-client";
import { verifyAccessToken, verifyIdToken } from "@/lib/fusionauth";
import { rolesFromClaims } from "@/lib/roles";

/**
 * FusionWorks keeps ONE encrypted, httpOnly session cookie — not a database
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
  accessToken: string;
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
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  };
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The cookie whose presence proxy.ts uses as a cheap signed-in check. */
export const sessionCookieName = SESSION_COOKIE;
