import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { redirectIfSignedIn } from "@/lib/auth/context";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  await redirectIfSignedIn(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your PayFlow workspace."
      footer={
        <>
          New to PayFlow?{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {reset === "1" && (
        <p
          role="status"
          className="bg-primary/10 text-primary rounded-lg px-3 py-2 text-sm font-medium"
        >
          Password updated. Sign in with your new password.
        </p>
      )}
      <OAuthButtons
        callbackURL={next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"}
      />
      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" />
        or continue with email
        <span className="bg-border h-px flex-1" />
      </div>
      <LoginForm next={next} />
    </AuthShell>
  );
}
