/**
 * Mock org data for FusionWorks — kept deliberately separate from the real
 * FusionAuth calls in lib/fusionauth.ts (the same split FusionBank uses between
 * lib/accounts.ts and lib/fusionauth.ts). Nothing here is a live lookup.
 *
 * Two things live in this file:
 *
 *  1. The Company → Department → Resource ENTITY TREE that the /directory page
 *     renders. Each node carries a stable `entityId` + `entityType` so you can
 *     seed a real FusionAuth instance with these exact Entities/Entity Types and
 *     the demo lights up against live data (see README). FusionAuth does NOT
 *     auto-cascade permissions down this tree — the /directory page walks it and
 *     computes effective access itself, which is the whole teaching point.
 *
 *  2. Everyday demo content — departments, employees, expense reports, a payroll
 *     summary — used by the dashboard, directory, approvals, and admin pages.
 *
 * "Department" here is app metadata, NOT a live FusionAuth Group lookup (group
 * membership isn't on the JWT by default — see lib/roles.ts).
 */

import { ROLE_MANAGER, adminRoleName, hasRole, isAdmin } from "@/lib/roles";

export type EntityType = "Company" | "Department" | "Resource";

/** A node in the org's entity hierarchy. */
export interface OrgNode {
  /** Stable UUID — matches an Entity you can create in FusionAuth. */
  entityId: string;
  entityType: EntityType;
  name: string;
  description: string;
  /** Department accent hex (inherited by a department's resources for display). */
  accent?: string;
  children?: OrgNode[];
}

/**
 * The showcase organization. One Company root, its Departments, and the
 * sensitive Resources inside each. Entity IDs are fixed so they can be recreated
 * verbatim in a FusionAuth instance for a live demo.
 */
export const ORG_TREE: OrgNode = {
  entityId: "00000000-0000-4000-a000-000000000001",
  entityType: "Company",
  name: "Northwind Trading Co.",
  description: "The customer org. Modeled in FusionAuth as a Company entity.",
  children: [
    {
      entityId: "00000000-0000-4000-a000-000000000010",
      entityType: "Department",
      name: "Engineering",
      description: "Builds and runs Northwind's platform.",
      accent: "#3b5bdb",
      children: [
        {
          entityId: "00000000-0000-4000-a000-000000000011",
          entityType: "Resource",
          name: "Source Repository",
          description: "Production application source and deploy keys.",
        },
        {
          entityId: "00000000-0000-4000-a000-000000000012",
          entityType: "Resource",
          name: "Incident Runbooks",
          description: "On-call procedures and infrastructure credentials.",
        },
      ],
    },
    {
      entityId: "00000000-0000-4000-a000-000000000020",
      entityType: "Department",
      name: "Finance",
      description: "Owns payroll, budgets, and expense approvals.",
      accent: "#0d9488",
      children: [
        {
          entityId: "00000000-0000-4000-a000-000000000021",
          entityType: "Resource",
          name: "Payroll Ledger",
          description: "Salary and compensation records. Step-up protected.",
        },
        {
          entityId: "00000000-0000-4000-a000-000000000022",
          entityType: "Resource",
          name: "Expense Reports",
          description: "Submitted employee expenses awaiting approval.",
        },
      ],
    },
    {
      entityId: "00000000-0000-4000-a000-000000000030",
      entityType: "Department",
      name: "People Ops",
      description: "Hiring, onboarding, and employee records.",
      accent: "#7c3aed",
      children: [
        {
          entityId: "00000000-0000-4000-a000-000000000031",
          entityType: "Resource",
          name: "Hiring Pipeline",
          description: "Candidate records and interview feedback.",
        },
      ],
    },
  ],
};

/** Flattens the tree to a lookup of entityId → node (with its parent chain). */
export interface FlatNode {
  node: OrgNode;
  /** Ancestor entity IDs from root → parent (excludes the node itself). */
  ancestors: string[];
  depth: number;
}

export function flattenOrg(root: OrgNode = ORG_TREE): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (node: OrgNode, ancestors: string[], depth: number) => {
    out.push({ node, ancestors, depth });
    for (const child of node.children ?? []) {
      walk(child, [...ancestors, node.entityId], depth + 1);
    }
  };
  walk(root, [], 0);
  return out;
}

// ---------------------------------------------------------------------------
// Grants — the shape lib/fusionauth.ts returns from searchEntityGrants, and a
// mock generator so /directory works before you've seeded a real instance.
// ---------------------------------------------------------------------------

/** Permissions our Resource/Department entity types define. */
export type Permission = "view" | "edit";

/** One User→Entity grant: which permissions the user holds on one entity. */
export interface EntityGrant {
  entityId: string;
  permissions: Permission[];
}

/**
 * Simulated grants for a demo user, keyed off their roles. This stands in for a
 * live `searchEntityGrants(userId)` call when the instance has no Entities
 * seeded — the /directory page uses real grants when available and these
 * otherwise (with a visible banner). Grants are assigned to specific NODES only;
 * the page must traverse the tree to decide anything about parents/children,
 * because FusionAuth never cascades them automatically.
 */
export function demoGrantsForRoles(roles: string[]): EntityGrant[] {
  const grants: EntityGrant[] = [
    // Everyone can view their department's day-to-day resources.
    { entityId: "00000000-0000-4000-a000-000000000012", permissions: ["view"] },
    { entityId: "00000000-0000-4000-a000-000000000022", permissions: ["view"] },
  ];

  if (hasRole(roles, ROLE_MANAGER) || isAdmin(roles)) {
    // Managers can edit expense reports and view the payroll ledger.
    grants.push(
      { entityId: "00000000-0000-4000-a000-000000000022", permissions: ["view", "edit"] },
      { entityId: "00000000-0000-4000-a000-000000000021", permissions: ["view"] }
    );
  }

  if (isAdmin(roles)) {
    // Admins additionally hold a grant on the Engineering DEPARTMENT node —
    // note this does NOT automatically grant its child resources; the directory
    // has to decide whether to honor it by walking the hierarchy.
    grants.push({
      entityId: "00000000-0000-4000-a000-000000000010",
      permissions: ["view", "edit"],
    });
  }

  return grants;
}

// ---------------------------------------------------------------------------
// People — used by the dashboard (the signed-in employee's demo profile),
// the directory people list, and the admin team roster.
// ---------------------------------------------------------------------------

export interface DemoEmployee {
  employeeId: string;
  name: string;
  title: string;
  department: string;
  /** Which app role this person maps to, for the admin roster display. */
  role: string;
  email: string;
}

export const demoTeam: DemoEmployee[] = [
  {
    employeeId: "E-1042",
    name: "Priya Nair",
    title: "Engineering Manager",
    department: "Engineering",
    role: ROLE_MANAGER,
    email: "priya.nair@northwind.example",
  },
  {
    employeeId: "E-2213",
    name: "Marcus Bell",
    title: "Staff Engineer",
    department: "Engineering",
    role: "employee",
    email: "marcus.bell@northwind.example",
  },
  {
    employeeId: "E-3391",
    name: "Dana Okafor",
    title: "Finance Lead",
    department: "Finance",
    role: ROLE_MANAGER,
    email: "dana.okafor@northwind.example",
  },
  {
    employeeId: "E-4457",
    name: "Sven Holt",
    title: "People Ops Partner",
    department: "People Ops",
    role: "employee",
    email: "sven.holt@northwind.example",
  },
];

/**
 * A stable-but-fake employee profile for whoever is signed in. Department and
 * employee number are demo metadata derived deterministically from the user's
 * id/email so the badge looks consistent across a session — NOT a FusionAuth
 * lookup. The role comes from the real verified token (passed in) and is the
 * one thing here that's authoritative.
 */
const DEPARTMENTS = ["Engineering", "Finance", "People Ops"] as const;

export function demoProfileFor(opts: {
  userId: string;
  roles: string[];
}): { department: string; employeeId: string; roleTitle: string } {
  let hash = 0;
  for (const ch of opts.userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const department = DEPARTMENTS[hash % DEPARTMENTS.length];
  const employeeId = `E-${1000 + (hash % 9000)}`;
  const roleTitle = isAdmin(opts.roles)
    ? "Workspace Administrator"
    : hasRole(opts.roles, ROLE_MANAGER)
      ? `${department} Manager`
      : `${department} Team Member`;
  return { department, employeeId, roleTitle };
}

/** Accent color for a department name (used for badge bands + directory chips). */
export function departmentAccent(department: string): string {
  switch (department) {
    case "Engineering":
      return "#3b5bdb";
    case "Finance":
      return "#0d9488";
    case "People Ops":
      return "#7c3aed";
    default:
      return "#5a6478";
  }
}

// ---------------------------------------------------------------------------
// Approvals content — payroll summary + expense reports (mock).
// ---------------------------------------------------------------------------

export interface PayrollLine {
  department: string;
  headcount: number;
  monthlyCents: number;
}

export const payrollSummary: PayrollLine[] = [
  { department: "Engineering", headcount: 24, monthlyCents: 41_20_000 },
  { department: "Finance", headcount: 9, monthlyCents: 14_85_000 },
  { department: "People Ops", headcount: 6, monthlyCents: 8_40_000 },
];

export interface ExpenseReport {
  id: string;
  submitter: string;
  category: string;
  amountCents: number;
  submitted: string; // ISO date
  status: "pending" | "approved";
}

export const expenseReports: ExpenseReport[] = [
  {
    id: "EXP-8841",
    submitter: "Marcus Bell",
    category: "Conference travel — KubeCon",
    amountCents: 2_140_00,
    submitted: "2026-07-14",
    status: "pending",
  },
  {
    id: "EXP-8839",
    submitter: "Sven Holt",
    category: "Recruiting lunch",
    amountCents: 186_50,
    submitted: "2026-07-12",
    status: "pending",
  },
];

/** Dollars-and-cents formatter shared across the money-facing pages. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.abs(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${dollars}`;
}

/** Role label for the admin roster, resolving the configurable admin name. */
export function roleLabel(role: string): string {
  if (role === adminRoleName()) return "Administrator";
  if (role === ROLE_MANAGER) return "Manager";
  return "Employee";
}
