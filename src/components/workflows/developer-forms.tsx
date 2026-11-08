"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, RotateCw, Send, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  pingWebhookAction,
  redeliverAction,
  revokeApiKeyAction,
} from "@/app/actions/workflows";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { API_SCOPES } from "@/lib/api/scopes";

function Secret({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div role="status" className="border-warning/40 bg-warning/10 space-y-2 rounded-xl border p-3">
      <p className="text-sm font-semibold">{title}</p>
      <div className="flex items-center gap-2">
        <code
          className="bg-card min-w-0 flex-1 overflow-x-auto rounded-lg border px-2 py-1.5 text-xs"
          data-testid="secret"
        >
          {value}
        </code>
        <Button
          size="icon"
          variant="outline"
          aria-label="Copy"
          onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied."))}
        >
          <Copy />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

export function ApiKeyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["employees:read"]);
  const [limit, setLimit] = useState("60");
  const [days, setDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createApiKeyAction({
              name,
              scopes,
              rateLimitPerMin: Number(limit),
              expiresInDays: days ? Number(days) : null,
            });
            if (!r.ok) return void toast.error(r.error);
            setCreated(r.data.key);
            setName("");
            router.refresh();
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-1">
            <Label htmlFor="k-name">Key name</Label>
            <Input
              id="k-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Accounting sync"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="k-limit">Requests per minute</Label>
            <Input
              id="k-limit"
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="k-days">Expires after (days, optional)</Label>
            <Input
              id="k-days"
              type="number"
              min={1}
              max={730}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Permissions</legend>
          {API_SCOPES.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={scopes.includes(s.id)}
                onChange={(e) =>
                  setScopes((cur) =>
                    e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id),
                  )
                }
              />
              {s.label} <code className="text-muted-foreground text-xs">{s.id}</code>
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={pending}>
          <KeyRound /> Create key
        </Button>
      </form>
      {created && (
        <Secret
          title="Copy your key now"
          value={created}
          hint="This is the only time it is shown. We store only a fingerprint, so a lost key must be replaced."
        />
      )}
    </div>
  );
}

export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Revoke ${name}`}
      onClick={() => {
        if (!confirm(`Revoke "${name}"? Anything using it stops working immediately.`)) return;
        start(async () => {
          const r = await revokeApiKeyAction({ id });
          if (!r.ok) toast.error(r.error);
          else router.refresh();
        });
      }}
    >
      Revoke
    </Button>
  );
}

export function WebhookForm({ events }: { events: readonly string[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([events[0]]);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createWebhookAction({ url, events: picked });
            if (!r.ok) return void toast.error(r.error);
            setSecret(r.data.secret);
            setUrl("");
            router.refresh();
          });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="w-url">Endpoint URL (https)</Label>
          <Input
            id="w-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/payflow-hook"
            required
          />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Events</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {events.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={picked.includes(ev)}
                  onChange={(e) =>
                    setPicked((cur) =>
                      e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev),
                    )
                  }
                />
                <code className="text-xs">{ev}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" disabled={pending}>
          <Webhook /> Add endpoint
        </Button>
      </form>
      {secret && (
        <Secret
          title="Signing secret"
          value={secret}
          hint="Use it to verify the signature on every delivery. It is shown only once."
        />
      )}
    </div>
  );
}

export function EndpointButtons({ id, url }: { id: string; url: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await pingWebhookAction({ id });
            if (!r.ok) return void toast.error(r.error);
            toast.success("Test event queued.");
            setTimeout(() => router.refresh(), 2500);
          })
        }
      >
        <Send /> Send test
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={pending}
        aria-label={`Delete endpoint ${url}`}
        onClick={() => {
          if (!confirm("Delete this endpoint? Pending deliveries are dropped.")) return;
          start(async () => {
            const r = await deleteWebhookAction({ id });
            if (!r.ok) toast.error(r.error);
            else router.refresh();
          });
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

export function RedeliverButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await redeliverAction({ id });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Queued again.");
            setTimeout(() => router.refresh(), 2500);
          }
        })
      }
    >
      <RotateCw /> Resend
    </Button>
  );
}
