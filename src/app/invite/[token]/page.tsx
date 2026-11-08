import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AcceptInvite } from "@/components/auth/accept-invite";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/context";

export const metadata = { title: "Join your company" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) {
    const next = encodeURIComponent(`/invite/${token}`);
    return (
      <AuthShell
        title="You've been invited"
        subtitle="Sign in or create an account with the email address your invitation was sent to."
      >
        <div className="flex gap-3">
          <Button asChild className="flex-1">
            <Link href={`/login?next=${next}`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href="/signup">Create account</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }
  if (!token || token.length < 20) redirect("/dashboard");
  return (
    <AuthShell title="Join your company" subtitle={`You're signed in as ${user.email}.`}>
      <AcceptInvite token={token} />
    </AuthShell>
  );
}
