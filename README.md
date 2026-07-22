# FusionWorks — a FusionAuth B2B2E demo

FusionWorks is an internal **people & approvals hub**: one product, sold to a
company, used by that company's employees. It's the **B2B2E** companion to
[FusionBank](../fusionbank) (which is B2C). Where FusionBank shows consumer MFA
and step-up auth, FusionWorks shows the enterprise story:

1. **Enterprise SSO** — employees sign in through their own company's identity
   provider (Entra ID / Okta / Google Workspace), never a FusionWorks password.
   Each company button on the landing page deep-links straight to its IdP via
   FusionAuth's `idp_hint`; a "type your work email" fallback uses `login_hint`.
2. **Groups → Application Roles** — department/group membership drives what
   someone can do (employee vs. manager vs. admin), read off the **verified
   access-token `roles` claim** — no JWT Populate lambda needed.
3. **Entity Management** — the org modeled as Company → Department → Resource,
   with per-entity grants, and an honest UI about the fact that **FusionAuth
   doesn't auto-cascade permissions** across the hierarchy (that's FGA by
   Permify).
4. **Step-up auth** — viewing payroll or approving an expense re-checks MFA
   mid-session, the same status → challenge → verify flow as FusionBank's
   transfer.
5. **Self-service account management** — links out to FusionAuth's hosted
   `/account` pages instead of building profile/password/MFA screens.

Same conventions as FusionBank: **direct Authorization Code + PKCE** against
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
  (SAML v2 or OIDC). Companies with no IdP configured render as "Not configured
  yet" rather than erroring, so you can start with one and add more.
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
| `FUSIONAUTH_CLIENT_ID` / `FUSIONAUTH_CLIENT_SECRET` | The FusionWorks Application's OAuth credentials. `client_id` is also the JWT `aud`. |
| `FUSIONAUTH_API_KEY` | Server-side key for the Two-Factor (step-up) and Entity Management calls. |
| `FUSIONAUTH_TENANT_ID` | *(optional)* Pin a specific tenant. |
| `APP_BASE_URL` | Public URL of this app; builds the OAuth `redirect_uri` and same-origin guards. |
| `SESSION_SECRET` | Secret hashed to the AES key that encrypts the session cookie. `openssl rand -base64 48`. |
| `FUSIONWORKS_ADMIN_ROLE` | *(optional)* Role name that unlocks `/admin`. Defaults to `admin`. |
| `FUSIONAUTH_IDP_ID_NORTHWIND` / `_VERTEX` / `_MERIDIAN` | Each demo company's Identity Provider **UUID** for `idp_hint`. |
| `FUSIONAUTH_TENANT_MANAGER_URL` | *(optional)* Exact Tenant Manager URL linked from `/admin`. |

Companies are configured in [`lib/companies.ts`](./lib/companies.ts) — add or
remove entries freely; the landing grid adapts and each new company just needs
its own `FUSIONAUTH_IDP_ID_*` var.

---

## FusionAuth admin setup

### 1. Create the FusionWorks Application

1. **Applications → Add**. Name it *FusionWorks*.
2. On the **OAuth** tab, set the Authorized redirect URL to
   `http://localhost:3000/api/auth/callback` (and your deployed URL), and the
   Logout URL to `http://localhost:3000`. Enable the **Authorization Code**
   grant and **PKCE** (required — this app always sends `code_challenge`).
3. Copy the **Client Id** and **Client secret** into `FUSIONAUTH_CLIENT_ID` /
   `FUSIONAUTH_CLIENT_SECRET`.
4. Note that FusionAuth's `post_logout_redirect_uri` is matched **exactly**
   against the registered URLs — the app deliberately drops a trailing slash off
   a bare origin so it matches (see `safePostLogoutRedirect` in `lib/bff.ts`).

### 2. Configure each company's Identity Provider

Each demo company represents an enterprise customer connecting their own IdP.
Two well-documented paths (either works for `idp_hint`):

- **Okta via OIDC** — FusionAuth docs:
  *Identity Providers → OpenID Connect*, plus Okta's app-integration guide.
  Create an OIDC IdP in FusionAuth, paste Okta's client id/secret and issuer,
  and **enable it for the FusionWorks application**.
- **Google Workspace via SAML v2** — FusionAuth docs:
  *Identity Providers → SAML v2*. Create the SAML IdP, upload Google's IdP
  metadata/certificate, and enable it for the FusionWorks application.
- **Entra ID** — either OIDC or SAML v2; both have FusionAuth guides.

For **managed-domain routing** (the "type your work email" flow via
`login_hint`), set each IdP's **Managed domains** to that company's email domain
(e.g. `northwind.example`). FusionAuth then matches a typed email to the right
IdP automatically. *(Note: `login_hint` does not work with SAML v2
IdP-Initiated or HYPR providers.)*

### 3. Find each IdP's UUID (for `idp_hint`)

`idp_hint` takes the **Identity Provider's Id (UUID)**. In the FusionAuth admin,
go to **Settings → Identity Providers**; the **Id** column shows each provider's
UUID (also on the provider's edit screen). Copy it into the matching
`FUSIONAUTH_IDP_ID_*` var. Appending `&idp_hint=<uuid>` to `/oauth2/authorize`
skips FusionAuth's hosted IdP picker and redirects straight to that provider —
which is exactly what each company button builds.

### 4. Groups & Roles (department-based RBAC)

1. On the FusionWorks Application, define **Roles**: `employee`, `manager`, and
   `admin` (match `FUSIONWORKS_ADMIN_ROLE` if you rename `admin`).
2. Create **Groups** (e.g. *Engineering*, *Finance*, *People Ops*) and attach
   the appropriate FusionWorks Application **Role** to each group.
3. Add users to groups. Because role claims from group membership ride on the
   **access token** automatically once the user is registered for the
   application, FusionWorks role-gates entirely off the verified token — the
   `/admin` page checks for the admin role, the badge shows the highest role.

> **Group membership itself is *not* on the JWT by default** (that needs a JWT
> Populate lambda calling the Group API — a paid feature). So FusionWorks treats
> "department" as demo metadata (`lib/org.ts`) and drives every authorization
> decision from the `roles` claim only. The ID token also does **not** carry
> `roles` (removed in 1.24.0) — this app reads roles from the **access token**.

### 5. API key permissions

Create an API key (**Settings → API Keys**) with permission on:

- `POST /api/two-factor/status` — step-up: is a challenge required?
- `POST /api/two-factor/start` and `POST /api/two-factor/send` — begin the
  challenge and deliver an email/SMS code.
- `POST /api/two-factor/login` — complete the challenge with the entered code.
- `POST /api/entity/grant/search` — the Entity Management directory (paid plan).

Step-up also needs an **MFA policy** (or a lambda) that actually asks for a
challenge on the `stepUp` action for the sensitive operations; otherwise
`/status` returns 200 and the payroll/expense actions complete without a prompt.

---

## How auth works here (the one-file tour)

- **`lib/fusionauth.ts`** — every FusionAuth interaction: building the
  authorize/logout URLs (with `idp_hint`/`login_hint`/`tenantId`), the PKCE code
  exchange, JWKS verification of the id/access tokens, the two-factor step-up
  calls, and the Entity grant reads. Point at this file during a demo.
- **`lib/session.ts`** — one encrypted, httpOnly cookie (`jose` `EncryptJWT`,
  `dir` + `A256GCM`, key derived from `SESSION_SECRET`). The cookie is opaque to
  the browser, and identity is only trusted after the **access token inside it
  is re-verified against JWKS on every read** — an expired/revoked token reads
  as logged-out even though the cookie decrypts fine. Roles come off that same
  verified token.
- **`proxy.ts`** — cheap cookie-presence gate on `/dashboard`, `/directory`,
  `/approvals`, `/admin`, `/settings`. Full verification is per-page/route.
- **`lib/org.ts` / `lib/companies.ts`** — all mock data, kept separate from real
  FusionAuth calls (the FusionBank `lib/accounts.ts` split).

---

## Entities vs. FGA by Permify (the `/directory` talking point)

FusionAuth **Entity Management** lets you model resources (Entity Types define
permissions; Entities are typed instances; Grants express User→Entity or
Entity→Entity relationships). But **FusionAuth does not automatically cascade
permissions up or down a hierarchy** — a grant on a department does not grant its
child resources. Your app must traverse grants itself.

The `/directory` page makes this visible: FusionAuth returns only the **direct
grants**, and every node the page marks **"via traversal"** is FusionWorks
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
   picker) via `idp_hint`. (Or type a work email to show `login_hint` managed-
   domain routing.)
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
