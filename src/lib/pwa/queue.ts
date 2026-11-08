export interface QueuedPunch {
  id: string;
  kind: "in" | "out";
  /** ISO time the person actually tapped the button. */
  at: string;
  point: { lat: number; lng: number } | null;
}

/** What to do with a queued punch after the server answered. */
export type SyncOutcome = "done" | "rejected" | "retry";

export function classifyResult(res: { ok: true } | { ok: false; error: string }): SyncOutcome {
  if (res.ok) return "done";
  // Already recorded (for example the first attempt reached the server but the reply was lost).
  if (/already checked in/i.test(res.error)) return "done";
  return "rejected";
}

/** Oldest first, so a check-in is always sent before its check-out. */
export const inOrder = (q: QueuedPunch[]) => [...q].sort((a, b) => a.at.localeCompare(b.at));

/**
 * Sends queued punches one at a time. A network failure stops the run and keeps the rest for later;
 * a server refusal drops that punch and reports why, so one bad entry never blocks the others.
 */
export async function drainQueue(
  queue: QueuedPunch[],
  send: (p: QueuedPunch) => Promise<{ ok: true } | { ok: false; error: string }>,
  remove: (id: string) => Promise<void>,
): Promise<{ synced: number; rejected: string[]; remaining: number }> {
  const sorted = inOrder(queue);
  let synced = 0;
  const rejected: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    let res;
    try {
      res = await send(p);
    } catch {
      return { synced, rejected, remaining: sorted.length - i };
    }
    const outcome = classifyResult(res);
    await remove(p.id);
    if (outcome === "done") synced++;
    else rejected.push(res.ok ? "" : res.error);
  }
  return { synced, rejected, remaining: 0 };
}

// ---- IndexedDB storage (browser only) ----
const DB = "payflow-offline";
const STORE = "punches";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const storage = {
  add: (p: QueuedPunch) => tx("readwrite", (s) => s.put(p)).then(() => undefined),
  all: () => tx<QueuedPunch[]>("readonly", (s) => s.getAll()),
  remove: (id: string) => tx("readwrite", (s) => s.delete(id)).then(() => undefined),
};
