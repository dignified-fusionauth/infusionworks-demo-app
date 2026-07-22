import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import OrgTree, { type OrgTreeRow, type AccessSource } from "@/components/OrgTree";
import { getSession } from "@/lib/session";
import { getGrantsForUser } from "@/lib/fusionauth";
import { flattenOrg, demoGrantsForRoles, type EntityGrant } from "@/lib/org";

/**
 * The Entity Management demo. FusionAuth models the org as Company → Department →
 * Resource entities, and returns the signed-in user's grants as a flat list
 * keyed by entity id. The teaching point: FusionAuth does NOT auto-cascade
 * permissions up or down that hierarchy — so this page walks the tree ITSELF and
 * marks each node "direct grant" (FusionAuth returned it) vs "via traversal"
 * (FusionWorks honored an ancestor's grant in app code). Automatic cascading is
 * exactly what FusionAuth FGA by Permify adds — called out below as a sales beat,
 * not working code.
 */

interface Access {
  view: boolean;
  edit: boolean;
}

/** Collapse a user's grants into an entityId → {view, edit} map (edit ⇒ view). */
function toAccessMap(grants: EntityGrant[]): Map<string, Access> {
  const map = new Map<string, Access>();
  for (const g of grants) {
    const edit = g.permissions.includes("edit");
    const view = edit || g.permissions.includes("view");
    const prev = map.get(g.entityId) ?? { view: false, edit: false };
    map.set(g.entityId, { view: prev.view || view, edit: prev.edit || edit });
  }
  return map;
}

export default async function DirectoryPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/login?redirect_uri=/directory");

  // Real grants when the Entity Management API is usable; otherwise demo grants
  // with an honest banner (getGrantsForUser returns null when unavailable).
  const realGrants = await getGrantsForUser(session.userId);
  const usingDemoGrants = realGrants === null;
  const grants = realGrants ?? demoGrantsForRoles(session.roles);

  const accessMap = toAccessMap(grants);

  const flat = flattenOrg();
  // Department accents so a resource visually inherits its department's color.
  const accentById = new Map<string, string>();
  for (const { node } of flat) {
    if (node.accent) accentById.set(node.entityId, node.accent);
  }

  const rows: OrgTreeRow[] = flat.map(({ node, ancestors, depth }) => {
    let view = false;
    let edit = false;
    let source: AccessSource = "none";

    const direct = accessMap.get(node.entityId);
    if (direct && (direct.view || direct.edit)) {
      view = direct.view;
      edit = direct.edit;
      source = "direct";
    } else {
      // No direct grant — walk ancestors nearest-first. FusionAuth never did
      // this for us; we're choosing to honor the closest ancestor grant.
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const inherited = accessMap.get(ancestors[i]);
        if (inherited && (inherited.view || inherited.edit)) {
          view = inherited.view;
          edit = inherited.edit;
          source = "inherited";
          break;
        }
      }
    }

    const parentId = ancestors[ancestors.length - 1];
    const accent = node.accent ?? (parentId ? accentById.get(parentId) : undefined);

    return {
      entityId: node.entityId,
      entityType: node.entityType,
      name: node.name,
      description: node.description,
      depth,
      accent,
      view,
      edit,
      source,
    };
  });

  return (
    <AppShell session={session}>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink font-[family-name:var(--font-display)]">
          Org directory
        </h1>
        <p className="mt-2 text-ink-soft">
          Modeled in FusionAuth as <strong className="text-ink">Entities</strong>:
          a Company, its Departments, and the sensitive Resources inside each.
          Grants say who can view or edit a given entity.
        </p>
      </div>

      {usingDemoGrants ? (
        <div
          role="status"
          className="mt-6 rounded-lg border border-signal/40 bg-signal-soft px-4 py-3 text-sm text-signal-ink"
        >
          <span className="font-semibold">Showing demo grants.</span> The Entity
          Management API isn&rsquo;t reachable (paid-plan feature, no entities
          seeded, or the API key lacks entity scopes). Seed the entity IDs from{" "}
          <code className="font-[family-name:var(--font-mono)]">lib/org.ts</code>{" "}
          and grant this user to see live data here.
        </div>
      ) : null}

      <div className="mt-6">
        <OrgTree rows={rows} />
      </div>

      {/* The no-auto-cascade teaching point. */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-bold text-ink font-[family-name:var(--font-display)]">
            FusionAuth doesn&rsquo;t cascade permissions
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            A grant on the Engineering <em>department</em> does not automatically
            grant its child resources. FusionAuth returns only the{" "}
            <span className="font-semibold text-ink">direct grants</span> above;
            every row tagged{" "}
            <span className="rounded border border-dashed border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-soft font-[family-name:var(--font-mono)]">
              via traversal
            </span>{" "}
            is FusionWorks walking the hierarchy in app code to decide effective
            access. That traversal logic is yours to own.
          </p>
        </div>
        <div className="rounded-xl border border-signal/40 bg-signal-soft/60 p-5">
          <h2 className="font-bold text-signal-ink font-[family-name:var(--font-display)]">
            Want automatic cascading?
          </h2>
          <p className="mt-2 text-sm text-signal-ink/90">
            That&rsquo;s <strong>FusionAuth FGA by Permify</strong> — relationship-
            and attribute-based access control with a schema that inherits across
            a hierarchy for you, so you don&rsquo;t hand-roll traversal. It&rsquo;s
            a separate authorization server on the Enterprise plan.{" "}
            <span className="font-semibold">Ask me about it.</span>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
