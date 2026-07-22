import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, verifyIdToken } from "@/lib/fusionauth";
import { setSession } from "@/lib/session";
import { STATE_COOKIE, VERIFIER_COOKIE, RETURN_COOKIE } from "@/lib/bff";

/**
 * GET /api/auth/callback
 *
 * FusionAuth redirects here after the employee authenticates through their
 * company's IdP (and completes any MFA the hosted pages required). We validate
 * `state`, exchange the code for tokens (PKCE), verify the id_token against
 * JWKS, seal the tokens into the encrypted session cookie, then send the
 * browser to the return path.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const error = searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const codeVerifier = request.cookies.get(VERIFIER_COOKIE)?.value;
  const returnTo = request.cookies.get(RETURN_COOKIE)?.value || "/dashboard";

  if (
    !code ||
    !state ||
    !expectedState ||
    state !== expectedState ||
    !codeVerifier
  ) {
    return NextResponse.redirect(new URL("/?error=invalid_state", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, codeVerifier);
    // Fail fast if the id_token doesn't verify — don't trust unchecked claims.
    if (tokens.id_token) {
      await verifyIdToken(tokens.id_token);
    }
    await setSession(tokens);
  } catch {
    // A failed code exchange or signature check means we never got a trusted
    // session. Send the user back to the landing page rather than surfacing an
    // unhandled 500 (which would leak a stack trace).
    return NextResponse.redirect(
      new URL("/?error=exchange_failed", request.url)
    );
  }

  const store = await cookies();
  store.delete(STATE_COOKIE);
  store.delete(VERIFIER_COOKIE);
  store.delete(RETURN_COOKIE);

  return NextResponse.redirect(new URL(returnTo, request.url));
}
