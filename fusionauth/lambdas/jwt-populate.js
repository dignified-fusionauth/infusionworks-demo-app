/**
 * InFusion Works — JWT Populate lambda
 * ------------------------------------
 * Adds the signed-in user's FusionAuth Group membership IDS to the ACCESS token
 * so the app can read real membership off the verified JWT instead of the old
 * mock "department" metadata (see lib/org.ts / lib/session.ts).
 *
 * WHY A LAMBDA IS NEEDED
 *   Application ROLES ride on the access token automatically (including roles a
 *   user inherits from a Group). Group MEMBERSHIP itself does not — FusionAuth
 *   never puts it on the JWT by default. This lambda closes that gap.
 *
 * WHY IDS ONLY (no names here)
 *   Inside a lambda the `user` object is read-only and each membership only
 *   exposes `groupId` (a UUID) — the group's NAME is not available, and a lambda
 *   can't call the Group API. Rather than hand-maintain a groupId -> name map in
 *   this file (maintenance debt: every new group means editing + redeploying the
 *   lambda), we emit ONLY the stable ids and let the app resolve names at
 *   runtime via GET /api/group/{groupId}, cached (see lib/fusionauth.ts
 *   `resolveGroupNames`). Ids are stable and never need this file to change.
 *
 * SETUP
 *   1. FusionAuth UI -> Customizations -> Lambdas -> Add.
 *        Type: "JWT populate".  Body: this file.
 *   2. Assign it on the Application -> JWT tab -> "JWT populate lambda".
 *   3. Have users log in again so a fresh token is minted.
 *
 * OUTPUT CLAIM
 *   jwt.groupIds -> string[]  e.g. ["00000000-0000-4000-a000-000000000010"]
 */
function populate(jwt, user, registration) {
  var groupIds = [];

  var memberships = user.memberships || [];
  for (var i = 0; i < memberships.length; i++) {
    var m = memberships[i];
    if (m && m.groupId && groupIds.indexOf(m.groupId) === -1) {
      groupIds.push(m.groupId);
    }
  }

  jwt.groupIds = groupIds;

  console.debug('Populated ' + groupIds.length + ' group id(s) onto the JWT');
}
