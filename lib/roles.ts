/**
 * Application Role helpers. In FusionAuth, an employee's Group membership maps
 * to Application Roles, and those roles ride on the ACCESS token's `roles` claim
 * automatically once the user is registered for the InFusion Works application —
 * including roles granted via Group membership, with no JWT Populate lambda.
 *
 * So InFusion Works role-gates entirely off the verified access-token `roles`
 * claim (see lib/session.ts): the /admin page checks for the admin role here,
 * and the dashboard badge shows the employee's highest role.
 *
 * Group membership ITSELF (which departments you're in) is NOT on the JWT by
 * default. InFusion Works surfaces it via a JWT Populate lambda
 * (fusionauth/lambdas/jwt-populate.js) that stamps a `groupIds` claim on the
 * access token; `groupIdsFromClaims` below reads those ids, and the app resolves
 * their display names at runtime with a cached Group-API lookup (see
 * lib/fusionauth.ts `resolveGroupNames`). When that lambda isn't assigned, the
 * claim is empty and the UI falls back to demo metadata. Authorization decisions
 * still key off `roles` only — groups are informational.
 */

/** The roles InFusion Works understands, least → most privileged. */
export const ROLE_EMPLOYEE = "employee";
export const ROLE_MANAGER = "manager";

/**
 * The admin role name is configurable so it can match whatever the customer's
 * FusionAuth application calls it. Defaults to "admin".
 */
export function adminRoleName(): string {
  return (process.env.INFUSIONWORKS_ADMIN_ROLE || "admin").trim();
}

/** Privilege order for picking a "primary" role to show on the badge. */
function roleRank(role: string): number {
  if (role === adminRoleName()) return 3;
  if (role === ROLE_MANAGER) return 2;
  if (role === ROLE_EMPLOYEE) return 1;
  return 0;
}

/**
 * Extracts roles from a set of verified token claims. FusionAuth emits `roles`
 * as a string array, but we tolerate a single string or comma-separated list
 * too, so a differently-configured tenant still works.
 */
export function rolesFromClaims(claims: Record<string, unknown>): string[] {
  const raw = claims.roles;
  if (Array.isArray(raw)) {
    return raw.filter((r): r is string => typeof r === "string" && r !== "");
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Extracts the user's Group membership IDS from verified token claims. These
 * come from the `groupIds` claim added by our JWT Populate lambda; the display
 * names are resolved separately (and cached) via lib/fusionauth.ts. We tolerate
 * a single string or comma-separated list the same way `rolesFromClaims` does.
 * Returns [] when the lambda isn't assigned (the claim is absent).
 */
export function groupIdsFromClaims(claims: Record<string, unknown>): string[] {
  const raw = claims.groupIds;
  if (Array.isArray(raw)) {
    return raw.filter((g): g is string => typeof g === "string" && g !== "");
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
  }
  return [];
}
export function hasRole(roles: string[], role: string): boolean {
  const target = role.toLowerCase();
  return roles.some((r) => r.toLowerCase() === target);
}

/** True when the user holds the (configurable) admin role. */
export function isAdmin(roles: string[]): boolean {
  return hasRole(roles, adminRoleName());
}

/** True when the user can approve (manager or admin). */
export function canApprove(roles: string[]): boolean {
  return hasRole(roles, ROLE_MANAGER) || isAdmin(roles);
}

export interface RoleBadgeStyle {
  label: string;
  /** Text color for the role chip. */
  color: string;
  /** Background for the role chip. */
  background: string;
}

/**
 * The single most-privileged role to feature on the employee's badge, with a
 * display label and chip colors. Falls back to a neutral "Guest" when the token
 * carries no recognized role (e.g. the user isn't registered for the app).
 */
export function primaryRoleBadge(roles: string[]): RoleBadgeStyle {
  const top = [...roles].sort((a, b) => roleRank(b) - roleRank(a))[0];
  if (top && top === adminRoleName()) {
    return { label: "Administrator", color: "#9a4e0a", background: "#fdecd8" };
  }
  if (top && top.toLowerCase() === ROLE_MANAGER) {
    return { label: "Manager", color: "#1e3a8a", background: "#e0e7ff" };
  }
  if (top && top.toLowerCase() === ROLE_EMPLOYEE) {
    return { label: "Employee", color: "#0f5132", background: "#d7f0e2" };
  }
  return { label: "Guest", color: "#5a6478", background: "#eceef4" };
}
