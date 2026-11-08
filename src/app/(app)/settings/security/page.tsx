import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TwoFactorPanel } from "@/components/auth/two-factor-panel";
import { requireContext } from "@/lib/auth/context";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const ctx = await requireContext();
  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm">
          Protect your account with an authenticator app.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Use an app such as Google Authenticator, Authy or 1Password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorPanel enabled={ctx.user.twoFactorEnabled} />
        </CardContent>
      </Card>
    </div>
  );
}
