import { AuthShell } from "@/components/auth/auth-shell";
import { TotpForm } from "@/components/auth/totp-form";

export const metadata = { title: "Two-factor verification" };

export default function TwoFactorPage() {
  return (
    <AuthShell
      title="Two-factor verification"
      subtitle="Open your authenticator app and enter the 6-digit code for PayFlow."
    >
      <TotpForm />
    </AuthShell>
  );
}
