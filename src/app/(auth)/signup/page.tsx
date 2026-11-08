import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { SignupForm } from "@/components/auth/signup-form";
import { redirectIfSignedIn } from "@/lib/auth/context";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  await redirectIfSignedIn();
  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up payroll for your company in minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <OAuthButtons callbackURL="/onboarding" />
      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" />
        or sign up with email
        <span className="bg-border h-px flex-1" />
      </div>
      <SignupForm />
    </AuthShell>
  );
}
