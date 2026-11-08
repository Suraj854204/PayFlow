"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";

type Step = "idle" | "password" | "scan";

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [uri, setUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  async function start() {
    setBusy(true);
    const res = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (res.error || !res.data || !("totpURI" in res.data)) {
      toast.error(res.error?.message ?? "Could not start setup. Check your password.");
      return;
    }
    setUri(res.data.totpURI);
    setBackupCodes(res.data.backupCodes);
    setStep("scan");
  }

  async function verify() {
    setBusy(true);
    const res = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (res.error) return toast.error(res.error.message ?? "That code did not match.");
    toast.success("Two-factor authentication is on.");
    setStep("idle");
    setPassword("");
    setCode("");
    router.refresh();
  }

  async function disable() {
    setBusy(true);
    const res = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (res.error)
      return toast.error(res.error.message ?? "Could not disable. Check your password.");
    toast.success("Two-factor authentication is off.");
    setStep("idle");
    setPassword("");
    router.refresh();
  }

  if (enabled) {
    return (
      <div className="space-y-4">
        <Badge tone="success">Enabled</Badge>
        {step === "password" ? (
          <div className="space-y-3">
            <Label htmlFor="pw">Confirm your password to turn it off</Label>
            <Input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <div className="flex gap-2">
              <Button variant="destructive" disabled={busy || !password} onClick={disable}>
                Turn off
              </Button>
              <Button variant="ghost" onClick={() => setStep("idle")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setStep("password")}>
            Turn off two-factor
          </Button>
        )}
      </div>
    );
  }

  if (step === "scan") {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-4 sm:w-fit">
          <QRCodeSVG value={uri} size={168} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Save your backup codes</p>
          <p className="text-muted-foreground text-xs">
            Each code works once if you lose your phone. Store them somewhere safe.
          </p>
          <div className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-3 font-mono text-xs sm:grid-cols-3">
            {backupCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">Enter the 6-digit code from your app</Label>
          <Input
            id="code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-40 font-mono tracking-widest"
          />
        </div>
        <Button disabled={busy || code.length !== 6} onClick={verify}>
          Verify and enable
        </Button>
      </div>
    );
  }

  if (step === "password") {
    return (
      <div className="space-y-3">
        <Label htmlFor="pw">Confirm your password to continue</Label>
        <Input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <div className="flex gap-2">
          <Button disabled={busy || !password} onClick={start}>
            Continue
          </Button>
          <Button variant="ghost" onClick={() => setStep("idle")}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Badge>Not enabled</Badge>
      <div>
        <Button onClick={() => setStep("password")}>Set up two-factor</Button>
      </div>
    </div>
  );
}
