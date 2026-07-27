"use client";

import { useMemo, useState } from "react";

/**
 * Demo-time JWT inspector for the dashboard. Each token handed in was ALREADY
 * verified server-side (the access token against FusionAuth's JWKS in
 * getSession(), the id_token likewise) before this renders — decoding here is
 * purely for display, so we never re-verify and never trust anything read out of
 * it. This component only formats what it's handed and layers on the interactive
 * bits (tabs, copy buttons, reveal-raw toggle) that force it to be a client
 * component.
 */

export interface DecodedToken {
  /** Short label for the tab, e.g. "Access token". */
  label: string;
  /** The already-verified claims (decoded payload). */
  claims: Record<string, unknown>;
  /** The raw compact JWT (header.payload.signature), for the "reveal" toggle. */
  rawToken: string;
}

interface JwtInspectorProps {
  tokens: DecodedToken[];
}

/** Claims that carry seconds-since-epoch timestamps in a FusionAuth JWT. */
const TIME_CLAIMS = new Set(["exp", "iat", "nbf", "auth_time"]);

/** Human-readable labels for the standard claims worth calling out in a demo. */
const CLAIM_LABELS: Record<string, string> = {
  iss: "Issuer",
  sub: "Subject (user id)",
  aud: "Audience (client id)",
  exp: "Expires",
  iat: "Issued at",
  auth_time: "Authenticated at",
  jti: "JWT id",
  scope: "Scope",
  roles: "Roles",
  groupIds: "Group ids",
  email: "Email",
  email_verified: "Email verified",
  name: "Name",
  given_name: "Given name",
  family_name: "Family name",
  preferred_username: "Preferred username",
  applicationId: "Application id",
  tid: "Tenant id",
};

/** Order the standard claims are surfaced in the humanized summary table. */
const SUMMARY_ORDER = [
  "iss",
  "sub",
  "aud",
  "iat",
  "exp",
  "auth_time",
  "roles",
  "groupIds",
  "scope",
  "name",
  "given_name",
  "family_name",
  "preferred_username",
  "email",
  "email_verified",
  "applicationId",
  "tid",
];

function formatTimestamp(seconds: number): string {
  const ms = seconds * 1000;
  const when = new Date(ms);
  const now = Date.now();
  const diffSec = Math.round((ms - now) / 1000);
  const abs = Math.abs(diffSec);

  const unit =
    abs < 60
      ? [abs, "second"]
      : abs < 3600
        ? [Math.round(abs / 60), "minute"]
        : abs < 86400
          ? [Math.round(abs / 3600), "hour"]
          : [Math.round(abs / 86400), "day"];
  const [n, name] = unit as [number, string];
  const plural = n === 1 ? name : `${name}s`;
  const relative = diffSec >= 0 ? `in ${n} ${plural}` : `${n} ${plural} ago`;

  return `${when.toUTCString()} · ${relative}`;
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked (e.g. insecure context) — no-op; not worth a modal.
        }
      }}
      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-surface"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function summaryRows(claims: Record<string, unknown>) {
  return SUMMARY_ORDER.filter((key) => claims[key] !== undefined).map((key) => {
    const value = claims[key];
    let display: string;
    if (TIME_CLAIMS.has(key) && typeof value === "number") {
      display = formatTimestamp(value);
    } else if (Array.isArray(value)) {
      display = value.length ? value.join(", ") : "(none)";
    } else {
      display = String(value);
    }
    return { key, label: CLAIM_LABELS[key] ?? key, display };
  });
}

function TokenView({ token }: { token: DecodedToken }) {
  const [showRaw, setShowRaw] = useState(false);

  const prettyJson = useMemo(
    () => JSON.stringify(token.claims, null, 2),
    [token.claims]
  );
  const rows = useMemo(() => summaryRows(token.claims), [token.claims]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card shadow-sm">
      {/* Standard claims, humanized */}
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.key}
              className={i > 0 ? "border-t border-line" : undefined}
            >
              <th
                scope="row"
                className="w-1/3 min-w-[8rem] bg-surface/60 px-4 py-2.5 text-left align-top font-medium text-ink-soft"
              >
                {row.label}
                <span className="ml-1 font-[family-name:var(--font-mono)] text-xs text-ink-soft/70">
                  {row.key}
                </span>
              </th>
              <td className="break-words px-4 py-2.5 align-top font-[family-name:var(--font-mono)] text-ink">
                {row.display}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Full payload + raw token controls */}
      <div className="border-t border-line bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Full payload
          </span>
          <CopyButton label="Copy JSON" value={prettyJson} />
          <CopyButton label="Copy raw JWT" value={token.rawToken} />
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-card"
          >
            {showRaw ? "Show decoded" : "Show raw token"}
          </button>
        </div>

        <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-line bg-ink px-4 py-3 text-xs leading-relaxed text-white">
          <code className="font-[family-name:var(--font-mono)] break-all whitespace-pre-wrap">
            {showRaw ? token.rawToken : prettyJson}
          </code>
        </pre>
      </div>
    </div>
  );
}

export default function JwtInspector({ tokens }: JwtInspectorProps) {
  const [active, setActive] = useState(0);
  const current = tokens[active] ?? tokens[0];

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold tracking-tight text-ink font-[family-name:var(--font-display)]">
          Decoded tokens
        </h2>
        <span className="rounded-full bg-verified-soft px-2.5 py-0.5 text-xs font-semibold text-verified">
          Signatures verified against JWKS
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        The JWTs FusionAuth issued for this session, decoded for demo reference.
        InFusion Works verified each token&rsquo;s signature, issuer, and audience
        server-side before rendering — nothing here is trusted client-side. The{" "}
        <span className="font-semibold text-ink">access token</span> carries
        authorization (the <code className="font-[family-name:var(--font-mono)] text-xs">roles</code>{" "}
        claim); the <span className="font-semibold text-ink">id token</span>{" "}
        carries who you are (profile claims).
      </p>

      {tokens.length > 1 ? (
        <div className="mt-5 flex gap-1 border-b border-line" role="tablist">
          {tokens.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={
                "-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition " +
                (i === active
                  ? "border-brand text-brand-ink"
                  : "border-transparent text-ink-soft hover:text-ink")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className={tokens.length > 1 ? "mt-4" : "mt-5"}>
        <TokenView key={current.label} token={current} />
      </div>
    </section>
  );
}
