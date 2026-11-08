import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Reset password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <AuthShell
        title="This link does not work"
        subtitle="The reset link is invalid, expired or already used. Links work for 60 minutes and only once."
      >
        <Link href="/forgot-password" className={buttonVariants({ className: "w-full" })}>
          Send a new link
        </Link>
        <p className="text-muted-foreground text-center text-sm">
          <Link href="/login" className="text-primary font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="You will be signed out on every device once it is saved."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
