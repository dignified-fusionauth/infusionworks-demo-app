import type { RoleBadgeStyle } from "@/lib/roles";
import RoleBadge from "@/components/RoleBadge";

/** Initials from a display name, for the badge photo placeholder. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export interface BadgeCardProps {
  name: string;
  email?: string;
  company: string;
  department: string;
  employeeId: string;
  roleBadge: RoleBadgeStyle;
  /** Department accent hex, used for the badge band. */
  accent: string;
}

/**
 * The signature visual element: the signed-in employee rendered as a photo-ID
 * access badge hanging from a lanyard. The department drives the color band; the
 * role chip comes from the verified access-token `roles` claim.
 */
export default function BadgeCard({
  name,
  email,
  company,
  department,
  employeeId,
  roleBadge,
  accent,
}: BadgeCardProps) {
  return (
    <div className="fw-animate-in w-full max-w-sm">
      {/* Lanyard strap + clip above the card */}
      <div className="fw-lanyard" aria-hidden="true">
        <span />
      </div>
      <div className="fw-clip" aria-hidden="true" />

      <div className="rounded-2xl border border-line bg-card shadow-lg overflow-hidden">
        {/* Punch hole */}
        <div className="pt-3">
          <div className="fw-punch" aria-hidden="true" />
        </div>

        {/* Colored department band + company */}
        <div
          className="mt-3 px-5 py-2.5 flex items-center justify-between"
          style={{ background: accent }}
        >
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/95 font-[family-name:var(--font-display)]">
            {company}
          </span>
          <span className="text-xs font-[family-name:var(--font-mono)] text-white/85">
            {department}
          </span>
        </div>

        {/* Identity */}
        <div className="px-5 py-5 flex items-start gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white font-[family-name:var(--font-display)]"
            style={{ background: accent }}
            aria-hidden="true"
          >
            {initials(name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-ink font-[family-name:var(--font-display)]">
              {name}
            </p>
            {email ? (
              <p className="truncate text-sm text-ink-soft">{email}</p>
            ) : null}
            <div className="mt-2">
              <RoleBadge badge={roleBadge} />
            </div>
          </div>
        </div>

        {/* Barcode + employee id */}
        <div className="px-5 pb-5">
          <div className="fw-barcode rounded-sm" aria-hidden="true" />
          <div className="mt-1.5 flex items-center justify-between text-xs font-[family-name:var(--font-mono)] text-ink-soft">
            <span>EMPLOYEE ID</span>
            <span className="tracking-widest text-ink">{employeeId}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
