import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import AccountLinks from "@/components/AccountLinks";
import { getSession } from "@/lib/session";
import { accountManagementUrl, twoFactorManagementUrl } from "@/lib/fusionauth";

/**
 * Account settings. Like FusionBank, InFusion Works doesn't build its own profile/
 * password/MFA screens — it links out to FusionAuth's hosted, themable
 * self-service /account pages. The two-factor page is where a user enrolls the
 * methods the /approvals step-up challenge later uses.
 */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/api/auth/login?redirect_uri=/settings");

  return (
    <AppShell session={session}>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-ink font-[family-name:var(--font-display)]">
          Account settings
        </h1>
        <p className="mt-2 text-ink-soft">
          Your profile lives in FusionAuth, not InFusion Works. These open its
          hosted self-service pages — the same account UI across every app your
          company signs into with this identity.
        </p>

        <div className="mt-8">
          <AccountLinks
            accountUrl={accountManagementUrl()}
            twoFactorUrl={twoFactorManagementUrl()}
          />
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-line bg-card/60 p-4 text-sm text-ink-soft">
          <span className="font-semibold text-ink">Why link out?</span> Owning
          profile, password, and MFA management in one hosted place means it
          stays consistent and secure across every application — and you theme it
          once in the FusionAuth admin console.
        </div>
      </div>
    </AppShell>
  );
}
