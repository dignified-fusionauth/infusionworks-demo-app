import type { EntityType } from "@/lib/org";

export type AccessSource = "direct" | "inherited" | "none";

export interface OrgTreeRow {
  entityId: string;
  entityType: EntityType;
  name: string;
  description: string;
  depth: number;
  accent?: string;
  view: boolean;
  edit: boolean;
  /**
   * How the access was determined:
   *  - "direct":    a grant exists on this exact entity
   *  - "inherited": no direct grant, but InFusion Works decided to honor an
   *                 ancestor's grant by walking the tree ITSELF (FusionAuth did
   *                 not cascade it)
   *  - "none":      no access
   */
  source: AccessSource;
}

function typeChipColor(type: EntityType): string {
  if (type === "Company") return "#1a2233";
  if (type === "Department") return "#3b5bdb";
  return "#5a6478";
}

function AccessPill({ row }: { row: OrgTreeRow }) {
  if (row.source === "none") {
    return (
      <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-soft">
        No access
      </span>
    );
  }
  const label = row.edit ? "Can edit" : "Can view";
  const isEdit = row.edit;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          isEdit
            ? "bg-signal-soft text-signal-ink"
            : "bg-verified-soft text-verified"
        }`}
      >
        {label}
      </span>
      {row.source === "inherited" ? (
        <span
          title="FusionAuth did not cascade this — InFusion Works computed it by traversing the hierarchy in app code."
          className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft font-[family-name:var(--font-mono)]"
        >
          via traversal
        </span>
      ) : (
        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft font-[family-name:var(--font-mono)]">
          direct grant
        </span>
      )}
    </span>
  );
}

/**
 * Renders the Company → Department → Resource entity tree with the signed-in
 * user's effective access per node. "direct grant" vs "via traversal" makes the
 * no-auto-cascade point visible: FusionAuth returns only direct grants; anything
 * marked "via traversal" is InFusion Works walking the hierarchy itself.
 */
export default function OrgTree({ rows }: { rows: OrgTreeRow[] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-card">
      {rows.map((row) => (
        <li
          key={row.entityId}
          className="flex items-center justify-between gap-4 px-4 py-3"
          style={{ paddingLeft: `${16 + row.depth * 22}px` }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                style={{ background: row.accent ?? typeChipColor(row.entityType) }}
              >
                {row.entityType}
              </span>
              <span className="truncate font-semibold text-ink">{row.name}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-ink-soft">
              {row.description}
            </p>
          </div>
          <div className="shrink-0">
            <AccessPill row={row} />
          </div>
        </li>
      ))}
    </ul>
  );
}
