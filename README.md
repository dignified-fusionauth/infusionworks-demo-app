# InFusion Works — a FusionAuth B2B2E demo

InFusion Works is an internal **people & approvals hub**: one product, sold to a
company, used by that company's employees. It's the **B2B2E** companion to
[InFusion Bank](https://github.com/dignified-fusionauth/infusionbank-demo-app) (which is B2C). Where InFusion Bank shows consumer MFA
and step-up auth, InFusion Works shows the enterprise story:

1. **Enterprise SSO** — employees sign in through their own company's identity
   provider (Entra ID / Okta / Google Workspace) or an on-prem directory (LDAP),
   never a InFusion Works password. Each company button on the landing page
   deep-links straight to its IdP via FusionAuth's `idp_hint`; a "type your work
   email" box **auto-discovers** the right IdP + tenant from the email domain
   (see [Email auto-discovery](#email-auto-discovery-type-your-work-email)).
   InFusion Works is a **Universal Application** and each company lives in its own
   **tenant**, so every login is pinned to the right tenant — resolved from the
   company's tenant-scoped IdP (see
   [Multi-tenant login](#multi-tenant-login-universal-application)).
2. **Groups → Application Roles** — department/group membership drives what
   someone can do (employee vs. manager vs. admin), read off the **verified
   access-token `roles` claim** — no JWT Populate lambda needed.
3. **Entity Management** — the org modeled as Company → Department → Resource,
   with per-entity grants, and an honest UI about the fact that **FusionAuth
   doesn't auto-cascade permissions** across the hierarchy (that's FGA by
   Permify).
4. **Step-up auth** — viewing payroll or approving an expense re-checks MFA
   mid-session, the same status → challenge → verify flow as InFusion Bank's
   transfer.
5. **Self-service account management** — links out to FusionAuth's hosted
   `/account` pages instead of building profile/password/MFA screens.

Same conventions as InFusion Bank: **direct Authorization Code + PKCE** against
FusionAuth's OAuth endpoints (no NextAuth.js, no `@fusionauth/react-sdk`), a
single **encrypted `jose` session cookie**, all FusionAuth calls centralized in
`lib/fusionauth.ts`, and route protection in **`proxy.ts`** (Next.js 16 renamed
`middleware` → `proxy`).

---

## Tech stack

- **Next.js 16** (App Router, Turbopack), React 19, TypeScript, Tailwind v4.
- **`@fusionauth/typescript-client`** for server-side FusionAuth API calls.
- **`jose`** for JWKS verification and the encrypted session cookie.
- No database — the only two data sources are FusionAuth and the mock data in
  `lib/org.ts` / `lib/companies.ts`.

> **Route protection lives in `proxy.ts`, not `middleware.ts`.** Next.js 16
> deprecated and renamed `middleware` to `proxy` (it runs on the Node.js runtime
> by default). `proxy.ts` does only a cheap cookie-presence check; real
> verification happens per-request in `getSession()`.

---

## Prerequisites

- Node.js 20+ and npm.
- A running **FusionAuth** instance (self-hosted or FusionAuth Cloud). The demo
  compiles and builds with placeholder env; you need a real instance only to
  actually sign in.
- At least one configured **Identity Provider** per company you want to enable
  (SAML v2 or OIDC), each **tenant-scoped** to that company's tenant (FusionAuth
  1.62.0+) since the login reads the tenant off the IdP. Companies with no IdP
  configured render as "Not configured yet" rather than erroring, so you can
  start with one and add more. A company can alternatively have **no IdP at all**
  (e.g. an **LDAP connector**, which FusionAuth authenticates on its hosted login
  page); such a card links to the default hosted login instead of an `idp_hint`
  deep-link — see [Companies & login modes](#companies--login-modes).
- For the **Entity Management** page against live data and for **step-up auth**,
  a FusionAuth plan that includes those features. Without them the directory
  falls back to demo grants (with a visible banner) and step-up simply reports
  "no challenge required" if your MFA policy doesn't ask for one.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then fill in the values (see below)
npm run dev                        # http://localhost:3000
```

Build / verify:

```bash
npx tsc --noEmit
npx eslint .
npx next build
```

---

## Environment variables

Every variable is documented inline in [`.env.local.example`](./.env.local.example).
The essentials:

| Variable | What it is |
| --- | --- |
| `FUSIONAUTH_URL` | Base URL of your FusionAuth instance. |
| `FUSIONAUTH_CLIENT_ID` / `FUSIONAUTH_CLIENT_SECRET` | The InFusion Works Application's OAuth credentials. `client_id` is also the JWT `aud`. |
| `FUSIONAUTH_API_KEY` | Server-side key for the IdP-tenant lookup, Two-Factor (step-up), and Entity Management calls. Must be **non-tenant-scoped** (reads IdPs across tenants). |
| `FUSIONAUTH_TENANT_ID` | *(optional)* Fallback/default tenant. Per-login the tenant is resolved from the company's IdP; this is only used when that resolution yields nothing (e.g. a global IdP, or the plain login with no company). |
| `APP_BASE_URL` | Public URL of this app; builds the OAuth `redirect_uri` and same-origin guards. |
| `SESSION_SECRET` | Secret hashed to the AES key that encrypts the session cookie. `openssl rand -base64 48`. |
| `FUSIONWORKS_ADMIN_ROLE` | *(optional)* Role name that unlocks `/admin`. Defaults to `admin`. |
| `FUSIONAUTH_IDP_ID_NORTHWIND` / `_VERTEX` / `_MERIDIAN` | Each IdP-backed demo company's Identity Provider **UUID** for `idp_hint`. (The LDAP "Atlas" company has no IdP and needs no var.) |
| `FUSIONAUTH_TENANT_MANAGER_URL` | *(optional)* Exact Tenant Manager URL linked from `/admin`. |

Companies are configured in [`lib/companies.ts`](./lib/companies.ts) — add or
remove entries freely; the landing grid adapts. An IdP-backed company points at
its own `FUSIONAUTH_IDP_ID_*` var; a company with **no IdP** (e.g. LDAP) simply
omits `idpEnvVar` and its card falls back to the default hosted login. See
[Companies & login modes](#companies--login-modes).

---

## FusionAuth admin setup

### 1. Create the InFusion Works Application

1. **Applications → Add**. Name it *InFusion Works*.
2. On the **OAuth** tab, set the Authorized redirect URL to
   `http://localhost:3000/api/auth/callback` (and your deployed URL), and the
   **Logout URL** to `http://localhost:3000` (your real app URL in prod). Enable
   the **Authorization Code** grant and **PKCE** (required — this app always
   sends `code_challenge`).
3. Copy the **Client Id** and **Client secret** into `FUSIONAUTH_CLIENT_ID` /
   `FUSIONAUTH_CLIENT_SECRET`.
   - Make this a **Universal Application** (available to all tenants) so the one
     `client_id` serves every company/tenant. That's what makes `tenantId`
     required on every login — see
     [Multi-tenant login](#multi-tenant-login-universal-application).
4. The **Logout URL** is where users land after signing out, and it must be set
   per environment. Logout sends only `client_id` to `/account/logout` (no
   `post_logout_redirect_uri`), so this application setting — not the app —
   controls the post-logout landing page. See
   [Logout & the self-service account session](#logout--the-self-service-account-session).

### 2. Configure each company's Identity Provider

Each demo company represents an enterprise customer connecting their own IdP.
Two well-documented paths (either works for `idp_hint`):

- **Okta via OIDC** — FusionAuth docs:
  *Identity Providers → OpenID Connect*, plus Okta's app-integration guide.
  Create an OIDC IdP in FusionAuth, paste Okta's client id/secret and issuer,
  and **enable it for the InFusion Works application**.
- **Google Workspace via SAML v2** — FusionAuth docs:
  *Identity Providers → SAML v2*. Create the SAML IdP, upload Google's IdP
  metadata/certificate, and enable it for the InFusion Works application.
- **Entra ID** — either OIDC or SAML v2; both have FusionAuth guides.

For the **"type your work email" auto-discovery** flow, set each IdP's **Managed
domains** to that company's email domain(s) (e.g. `northwind.example`). The app
reads those domains back from FusionAuth to route a typed email to the right IdP
**and** its tenant — no domain list is hardcoded in the app. See
[Email auto-discovery](#email-auto-discovery-type-your-work-email) for exactly
how the match is done (and why it does **not** use the `/api/identity-provider/lookup`
endpoint).

### 3. Find each IdP's UUID (for `idp_hint`)

`idp_hint` takes the **Identity Provider's Id (UUID)**. In the FusionAuth admin,
go to **Settings → Identity Providers**; the **Id** column shows each provider's
UUID (also on the provider's edit screen). Copy it into the matching
`FUSIONAUTH_IDP_ID_*` var. Appending `&idp_hint=<uuid>` to `/oauth2/authorize`
skips FusionAuth's hosted IdP picker and redirects straight to that provider —
which is exactly what each company button builds.

Make each IdP **tenant-scoped** (created within that company's tenant — FusionAuth
1.62.0+), not global. The app reads the tenant off the IdP to pin the login to
the right tenant (see
[Multi-tenant login](#multi-tenant-login-universal-application)); a global IdP
has no owning tenant, so the login would fall back to `FUSIONAUTH_TENANT_ID`.

### 4. Groups & Roles (department-based RBAC)

1. On the InFusion Works Application, define **Roles**: `employee`, `manager`, and
   `admin` (match `FUSIONWORKS_ADMIN_ROLE` if you rename `admin`).
2. Create **Groups** (e.g. *Engineering*, *Finance*, *People Ops*) and attach
   the appropriate InFusion Works Application **Role** to each group.
3. Add users to groups. Because role claims from group membership ride on the
   **access token** automatically once the user is registered for the
   application, InFusion Works role-gates entirely off the verified token — the
   `/admin` page checks for the admin role, the badge shows the highest role.

> **Group membership itself is *not* on the JWT by default** (that needs a JWT
> Populate lambda calling the Group API — a paid feature). So InFusion Works treats
> "department" as demo metadata (`lib/org.ts`) and drives every authorization
> decision from the `roles` claim only. The ID token also does **not** carry
> `roles` (removed in 1.24.0) — this app reads roles from the **access token**.

### 5. API key permissions

Create an API key (**Settings → API Keys**) with permission on:

- `GET /api/identity-provider` — resolve each company's tenant from its IdP for
  the multi-tenant login, and build the domain→IdP map for
  [email auto-discovery](#email-auto-discovery-type-your-work-email) (see
  [Multi-tenant login](#multi-tenant-login-universal-application)).
- `POST /api/two-factor/status` — step-up: is a challenge required?
- `POST /api/two-factor/start` and `POST /api/two-factor/send` — begin the
  challenge and deliver an email/SMS code.
- `POST /api/two-factor/login` — complete the challenge with the entered code.
- `POST /api/entity/grant/search` — the Entity Management directory (paid plan).

> **The key must be non-tenant-scoped** (no tenant selected on the key). It reads
> IdPs that live in *other* tenants; a tenant-locked key would 404 on those and
> the login would silently fall back to the default tenant.

Step-up also needs an **MFA policy** (or a lambda) that actually asks for a
challenge on the `stepUp` action for the sensitive operations; otherwise
`/status` returns 200 and the payroll/expense actions complete without a prompt.

---

## How auth works here (the one-file tour)

- **`lib/fusionauth.ts`** — every FusionAuth interaction: building the
  authorize/logout URLs (with `idp_hint`/`login_hint`/`tenantId`), resolving a
  company's tenant from its IdP (`getTenantIdForIdp`), email→IdP auto-discovery
  (`lookupIdpByEmail`; see
  [Email auto-discovery](#email-auto-discovery-type-your-work-email)), the PKCE
  code exchange, JWKS verification of the id/access tokens, the two-factor step-up
  calls, and the Entity grant reads. Also home to the two tenant-scoping client
  helpers — `untenantedClient` (cross-tenant reads) and `oauthClient` (token calls
  pinned to the login's tenant); see
  [Multi-tenant login](#multi-tenant-login-universal-application). Point at this
  file during a demo.
- **`lib/bff.ts`** — the `/api/auth/*` glue: `startOAuthRedirect` reads the SSO
  hints off the query (`idpHint` / `loginHint` / `tenantId`), runs email
  auto-discovery when only an email is given, pins the resolved tenant, and sets
  the short-lived PKCE/state/return/tenant cookies for the callback. Also the
  open-redirect guard (`safeReturnTo`).
- **`lib/session.ts`** — one encrypted, httpOnly cookie (`jose` `EncryptJWT`,
  `dir` + `A256GCM`, key derived from `SESSION_SECRET`). The cookie is opaque to
  the browser, and identity is only trusted after the **access token inside it
  is re-verified against JWKS on every read** — an expired/revoked token reads
  as logged-out even though the cookie decrypts fine. Roles come off that same
  verified token.
- **`proxy.ts`** — cheap cookie-presence gate on `/dashboard`, `/directory`,
  `/approvals`, `/admin`, `/settings`. Full verification is per-page/route.
- **`lib/org.ts` / `lib/companies.ts`** — all mock data, kept separate from real
  FusionAuth calls (the InFusion Bank `lib/accounts.ts` split).

---

## Multi-tenant login (Universal Application)

InFusion Works signs in through a **Universal Application** — one `client_id`
that every tenant shares — and each demo company lives in its **own tenant**. A
universal application is *not* bound to a single tenant, so FusionAuth cannot
infer which tenant a login belongs to: **`tenantId` is required** on both the
authorize request and the token exchange, or FusionAuth rejects the request with
`missing_tenant_id`. There is no tenant discovery for universal apps, so the app
has to supply the tenant itself.

The tenant is derived from the company's **tenant-scoped Identity Provider**
(FusionAuth 1.62.0+), which carries its owning tenant as the top-level
`tenantId` on `GET /api/identity-provider/{id}`. The flow, all in
`lib/fusionauth.ts` + `lib/bff.ts` + the two `/api/auth/*` routes:

1. **`GET /api/auth/login?idpHint=<idpId>`** — `startOAuthRedirect` (`lib/bff.ts`)
   calls `getTenantIdForIdp(idpId)`, which reads the IdP's `tenantId`. An explicit
   `?tenantId=` query param overrides this.
2. The resolved tenant is put on the **authorize URL** (`&tenantId=…`, via
   `buildAuthorizeUrl`) *and* stashed in a short-lived `fw_oauth_tenant` cookie
   alongside the PKCE `state`/`verifier`.
3. After the IdP round trip, **`GET /api/auth/callback`** reads `fw_oauth_tenant`
   and passes it into `exchangeCodeForTokens(code, verifier, tenant)`, so the
   **`/oauth2/token` call is pinned to the same tenant the login ran in**. The
   code was issued under that tenant; pinning any other tenant (or none) fails.

Two client-scoping rules make this work and are easy to break — the shared
`FusionAuthClient` singleton sends `X-FusionAuth-TenantId: <FUSIONAUTH_TENANT_ID>`
on *every* call, which is the wrong tenant here:

- **Cross-tenant reads use an un-pinned client** (`untenantedClient`). Reading a
  company's IdP with the default-tenant header returns **404** (silently falling
  back to the default tenant, so the login lands in the wrong tenant). Dropping
  the header lets a non-tenant-scoped API key read instance-level objects in any
  tenant.
- **OAuth token calls use a client pinned to the login's tenant** (`oauthClient`),
  *not* the configured default. Pinning the default gives `invalid_grant` (the
  code isn't in that tenant); pinning nothing gives `missing_tenant_id`.

> **Requirements for this to work against a live instance:** the `FUSIONAUTH_API_KEY`
> must be **non-tenant-scoped** and include **`GET /api/identity-provider`** (see
> [API key permissions](#5-api-key-permissions)), and each company's IdP must be
> **tenant-scoped** so `identityProvider.tenantId` is populated. If an IdP is a
> *global* IdP (no owning tenant), `getTenantIdForIdp` returns nothing and the
> login falls back to `FUSIONAUTH_TENANT_ID` — for that case, map the tenant
> explicitly instead (e.g. a per-company tenant var in `lib/companies.ts`).

---

## Companies & login modes

The landing grid is driven entirely by the `companies` array in
[`lib/companies.ts`](./lib/companies.ts) — the page maps over it, so adding a
customer is a config change, not a code change. Each company resolves to one of
two **login modes**, decided by whether it names an IdP env var:

| Mode | When | Card behavior |
| --- | --- | --- |
| `"idp"` | The company sets `idpEnvVar` (e.g. `FUSIONAUTH_IDP_ID_NORTHWIND`) | Deep-links to `/api/auth/login?idpHint=<uuid>`, which becomes `idp_hint` on the authorize URL and skips FusionAuth's IdP picker. Disabled ("Not configured yet") until the env var holds a UUID. |
| `"default"` | The company omits `idpEnvVar` (e.g. an **LDAP connector**) | Links to `/api/auth/login` with **no** `idp_hint`. FusionAuth's hosted login authenticates the user (the LDAP connector runs there). Always enabled. |

`resolveCompany()` (in `lib/companies.ts`) sets `loginMode` and `configured`
accordingly, and `CompanyPicker.tsx` builds the right URL and CTA label ("Sign in
with SSO" vs. "Sign in") from it.

> **Why LDAP is `"default"`:** an **LDAP connector is not an Identity Provider**,
> so it has no IdP UUID and cannot be targeted with `idp_hint`. FusionAuth
> authenticates LDAP on its hosted login page directly. The demo's "Atlas LDAP
> Directory" company is modeled this way and needs no `FUSIONAUTH_IDP_ID_*` var.
> An LDAP-only login lands on the **default tenant** (`FUSIONAUTH_TENANT_ID`); if
> your connector lives in a non-default tenant, pass `?tenantId=` (or add a
> per-company tenant to the config).

---

## Email auto-discovery ("type your work email")

The "Not sure which one?" box on the landing page
([`components/WorkEmailForm.tsx`](./components/WorkEmailForm.tsx)) lets an
employee skip the company grid and just type their work email. The app resolves
that email's **domain → Identity Provider → owning tenant** and deep-links
straight into the right company's SSO — with **no domain→IdP mapping hardcoded in
the app**. The mapping is read live from each IdP's **Managed domains** in
FusionAuth.

### The flow

1. The form is a plain **GET** to `/api/auth/login?loginHint=<email>` — no client
   JS, progressively enhanced.
2. `startOAuthRedirect` (`lib/bff.ts`) sees a `loginHint` but no `idpHint`, and
   calls `lookupIdpByEmail(email)` in `lib/fusionauth.ts`.
3. `lookupIdpByEmail` extracts the domain (`dana@northwind.example` →
   `northwind.example`) and looks it up in a **domain → { idpId, tenantId } map**
   built from FusionAuth.
4. On a hit, the login redirects with **both** `idp_hint=<idpId>` **and**
   `tenantId=<owning tenant>` — the tenant is mandatory because this is a
   Universal Application (see
   [Multi-tenant login](#multi-tenant-login-universal-application)).
5. On a miss (no IdP owns the domain — e.g. an LDAP company, or an unknown
   address), the email is still passed through as `login_hint` and the user lands
   on the **default** hosted login.

### How the domain map is built (and why not the `lookup` endpoint)

`lookupIdpByEmail` builds its map by calling **`GET /api/identity-provider`**
(`retrieveIdentityProviders()`) with the **un-pinned** client, then matching the
domain against each IdP's `domains` (Managed domains) array and reading the
owning `tenantId` straight off the IdP object. The result is cached in-process
with a short TTL (`IDP_DOMAIN_TTL_MS`, default **5 min**) and in-flight
de-duplicated, so a burst of logins costs at most **one** list call per window.

FusionAuth *does* ship a purpose-built endpoint for this —
`GET /api/identity-provider/lookup?domain=…` — but it is **not** used here, on
purpose:

- **Discovery is tenant-agnostic.** An email alone doesn't tell you the tenant.
  The `lookup` endpoint only resolves **global** IdPs unless you pass a
  `tenantId` **query parameter** — but every customer IdP in this demo is
  **tenant-scoped**, so a plain lookup returns **404** (which is exactly the bug
  that made every typed email fall back to the default login during development).
- **You'd need N calls.** To use `lookup` for tenant-scoped IdPs you must already
  know the tenant, or loop `lookupIdentityProviderByTenantId(domain, tenantId)`
  once **per tenant**. Listing all IdPs once (cached) covers every tenant in a
  single call and hands back the owning `tenantId` we need anyway.
- (Gotcha for anyone re-testing `lookup`: it honors `tenantId` only as a **query
  parameter**, *not* via the `X-FusionAuth-TenantId` header — unlike the
  Identity Provider *search* API, which the header overrides.)

### Requirements

- Each customer IdP must have its **Managed domains** populated in FusionAuth
  (Settings → Identity Providers → *your IdP* → **Managed domains**). No domains
  → nothing to match → the email falls back to the default login.
- Same key requirement as multi-tenant login: `FUSIONAUTH_API_KEY` must be
  **non-tenant-scoped** and allow **`GET /api/identity-provider`** (see
  [API key permissions](#5-api-key-permissions)); otherwise the list read can't
  see IdPs across tenants and discovery silently returns nothing.
- Matching is **exact per domain** (same as FusionAuth's own managed-domain
  matching), so `dignifiedlabs.com` and `entraid.dignifiedlabs.com` stay distinct
  — no subdomain bleed.

---

## Logout & the self-service account session

Signing out has to end **three** independent sessions, not one — this is the
wrinkle that self-service account management adds:

1. **The app session** — our encrypted `fw_session` cookie.
2. **The FusionAuth SSO session** — the hosted-login session shared across every
   application in the tenant.
3. **The self-service account session** — a *separate* session FusionAuth mints
   (since 1.45.0) the first time a user opens the hosted `/account` pages, which
   InFusion Works links to from **Settings**. This is the catch: it is **not**
   ended by clearing the app session, and **not** ended by `/oauth2/logout`.
   Skipping it leaves the user still authenticated on `/account` after they've
   "signed out" of everything else.

`GET /api/auth/logout` handles all three in a single top-level navigation:

1. Deletes the local `fw_session` cookie (`clearSession()` in `lib/session.ts`).
2. Redirects the browser to **`/account/logout?client_id=…`**
   (`buildAccountLogoutUrl` in `lib/fusionauth.ts`).

That one endpoint chains the rest itself: it ends the account session, redirects
into `/oauth2/logout` (ending the SSO session), and finally lands the user on the
application's configured **Logout URL**. It has to be a real top-level
navigation — the account session lives in `HttpOnly`, `SameSite=Lax` cookies on
FusionAuth's origin, so it can't be reached from a background `fetch`, an
`<img>`, or a cross-origin iframe (all of which drop the cookie), and `/account`
is served with `X-Frame-Options: DENY` besides.

Two rules, both verified live against a real instance, are baked into the code
and easy to accidentally break:

- **Send only `client_id`.** Do *not* add a `post_logout_redirect_uri` to the
  `/account/logout` URL. If you pass a target that isn't a registered redirect
  URL, FusionAuth **abandons the logout entirely** and the account session
  survives — meanwhile the app has already dropped its own cookie, producing the
  confusing "app is logged out but `/account` is still authenticated" bug.
- **The landing page comes from the app's Logout URL**, not from a per-request
  value. Because we send no `post_logout_redirect_uri`, where the user ends up is
  controlled solely by the application's **Logout URL** in the FusionAuth admin
  (see [FusionAuth admin setup](#1-create-the-infusion-works-application)). Set
  it per environment.

> This mirrors the documented FusionAuth guidance for self-service logout —
> redirect to `/account/logout?client_id=…` — and the behavior tracked in
> [fusionauth-issues#2298](https://github.com/FusionAuth/fusionauth-issues/issues/2298).

---

## Entities vs. FGA by Permify (the `/directory` talking point)

FusionAuth **Entity Management** lets you model resources (Entity Types define
permissions; Entities are typed instances; Grants express User→Entity or
Entity→Entity relationships). But **FusionAuth does not automatically cascade
permissions up or down a hierarchy** — a grant on a department does not grant its
child resources. Your app must traverse grants itself.

The `/directory` page makes this visible: FusionAuth returns only the **direct
grants**, and every node the page marks **"via traversal"** is InFusion Works
walking the tree in app code to compute effective access (see the traversal in
`app/directory/page.tsx`). If you want inheritance handled *for* you — ReBAC/ABAC
with a schema that cascades — that's **FusionAuth FGA by Permify** (Enterprise
plan), a separate authorization server. The directory calls it out as a sales
beat; there's no live FGA integration in this demo.

The entity IDs in `lib/org.ts` are fixed UUIDs, so you can seed a real instance
with those exact Entities/Grants and the directory lights up against live data.

---

## Tenant Manager (the self-service SSO setup story)

There is **nothing to build in the app** for a customer to connect their own IdP.
Their IT admin does it themselves in FusionAuth's **Tenant Manager** (1.65.0+),
entirely in the hosted admin UI. That's the setup half of enterprise SSO; the
runtime half is `idp_hint`/`login_hint`, which is all this app touches. The
`/admin` page links out to Tenant Manager to make the division of labor explicit.

---

## ~5-minute demo script

1. **Pick a company.** On the landing page, click a configured company card —
   you're deep-linked *straight* to that company's IdP (no FusionAuth IdP
   picker) via `idp_hint`. (Or type a work email to show
   [auto-discovery](#email-auto-discovery-type-your-work-email): the app resolves
   the domain to the right IdP **and** tenant and deep-links there — or, for an
   LDAP/unknown domain, falls back to the default hosted login.)
2. **Land on a role-appropriate dashboard.** Your ID badge shows your name,
   company, department, and a **role chip read from the verified access token**.
   Point out that only the role is authoritative; department is demo metadata.
3. **Try approvals, hit step-up.** Open **Approvals** and click *View payroll* or
   *Approve expense*. FusionAuth is asked whether a step-up challenge is needed;
   if so, you re-swipe your badge (enter a two-factor code) before the data
   unlocks — MFA mid-session, no full re-login.
4. **Walk the org directory.** Open **Directory**. Show the direct grants vs.
   the **"via traversal"** tags, and use it to introduce the
   **Entities-vs-FGA-by-Permify** distinction — FusionAuth returns grants; FGA
   cascades them.
5. **Mention Tenant Manager.** On **Admin**, point at the Tenant Manager link:
   the customer's IT admin configures their SAML/OIDC connection themselves —
   the self-service setup story you didn't have to build.

---

## Non-goals

- No real SSO certs/secrets needed to *build* — placeholder env compiles,
  type-checks, and builds. It works for real once pointed at a FusionAuth
  instance with real IdPs configured.
- No live Permify/FGA server integration.
- No database — mock data and FusionAuth are the only data sources.
