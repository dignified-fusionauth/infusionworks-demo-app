import type { RoleBadgeStyle } from "@/lib/roles";

/** A small role chip (e.g. "Manager"), colored per primaryRoleBadge(). */
export default function RoleBadge({ badge }: { badge: RoleBadgeStyle }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ color: badge.color, background: badge.background }}
    >
      {badge.label}
    </span>
  );
}
