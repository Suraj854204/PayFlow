"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogIn, LogOut, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkInAction, checkOutAction } from "@/app/actions/attendance";
import { drainQueue, storage, type QueuedPunch } from "@/lib/pwa/queue";

function getPoint(required: boolean): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator))
      return required ? reject(new Error("This browser cannot share location.")) : resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () =>
        required
          ? reject(new Error("Allow location access to mark attendance at the office."))
          : resolve(null),
      { enableHighAccuracy: true, timeout: required ? 15000 : 4000, maximumAge: 30000 },
    );
  });
}

export function CheckPanel({
  state,
  fenceOn,
  checkedInAt,
  checkedOutAt,
}: {
  state: "none" | "in" | "done" | "leave";
  fenceOn: boolean;
  checkedInAt?: string;
  checkedOutAt?: string;
}) {
  const router = useRouter();
  const t = useTranslations("attendance");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(0);

  const sync = useCallback(async () => {
    if (typeof indexedDB === "undefined") return;
    try {
      const all = await storage.all();
      setQueued(all.length);
      if (all.length === 0 || !navigator.onLine) return;
      const r = await drainQueue(
        all,
        async (p) => {
          const res =
            p.kind === "in"
              ? await checkInAction({ point: p.point, at: p.at })
              : await checkOutAction({ point: p.point, at: p.at });
          return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
        },
        (id) => storage.remove(id),
      );
      setQueued(r.remaining);
      if (r.synced) toast.success(t("synced", { count: r.synced }));
      for (const e of r.rejected) toast.error(`An offline punch was refused: ${e}`);
      if (r.synced || r.rejected.length) router.refresh();
    } catch {
      /* storage unavailable: nothing to sync */
    }
  }, [router, t]);

  useEffect(() => {
    void sync();
    const onOnline = () => void sync();
    const onMsg = (e: MessageEvent) => e.data?.type === "sync-punches" && void sync();
    window.addEventListener("online", onOnline);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [sync]);

  async function enqueue(kind: "in" | "out", point: QueuedPunch["point"]) {
    const punch: QueuedPunch = {
      id: crypto.randomUUID(),
      kind,
      at: new Date().toISOString(),
      point,
    };
    await storage.add(punch);
    setQueued((n) => n + 1);
    try {
      const reg = await navigator.serviceWorker?.ready;
      await (
        reg as unknown as { sync?: { register: (t: string) => Promise<void> } }
      )?.sync?.register("payflow-punches");
    } catch {
      /* Background Sync is not available everywhere; the online event covers it. */
    }
    toast.success(t("savedOffline"));
  }
  const time = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

  async function go(kind: "in" | "out") {
    setBusy(true);
    try {
      const point = await getPoint(fenceOn);
      if (!navigator.onLine) {
        await enqueue(kind, point);
        setBusy(false);
        return;
      }
      start(async () => {
        let res;
        try {
          res = kind === "in" ? await checkInAction({ point }) : await checkOutAction({ point });
        } catch {
          // The request never reached the server: keep the punch on this device.
          await enqueue(kind, point);
          setBusy(false);
          return;
        }
        setBusy(false);
        if (!res.ok) return void toast.error(res.error);
        toast.success(kind === "in" ? t("checkedIn") : t("checkedOut"));
        router.refresh();
      });
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Could not get your location.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="text-sm">
        {state === "none" && <p className="text-muted-foreground">{t("notIn")}</p>}
        {state === "in" && <p>{t("checkedInAt", { time: time(checkedInAt) })}</p>}
        {state === "done" && (
          <p>{t("inOut", { in: time(checkedInAt), out: time(checkedOutAt) })}</p>
        )}
        {state === "leave" && <p className="text-muted-foreground">{t("onLeave")}</p>}
        {queued > 0 && (
          <p className="text-warning mt-1 text-xs" role="status" data-testid="offline-queued">
            {t("queued", { count: queued })}
          </p>
        )}
        {fenceOn && (
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <MapPin className="size-3" /> {t("fence")}
          </p>
        )}
      </div>
      {state === "none" && (
        <Button onClick={() => go("in")} disabled={pending || busy}>
          <LogIn /> {t("checkIn")}
        </Button>
      )}
      {state === "in" && (
        <Button variant="outline" onClick={() => go("out")} disabled={pending || busy}>
          <LogOut /> {t("checkOut")}
        </Button>
      )}
    </div>
  );
}
