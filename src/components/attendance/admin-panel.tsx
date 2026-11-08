"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  assignRosterAction,
  createShiftAction,
  lockMonthAction,
  manualAttendanceAction,
  saveWorkplaceAction,
  unlockMonthAction,
} from "@/app/actions/attendance";

const sel = "border-input bg-background h-9 w-full rounded-lg border px-2 text-sm";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type R = { ok: true } | { ok: false; error: string };

function useRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<R>, ok: string, reset?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      reset?.();
      router.refresh();
    });
  return { pending, run };
}

export function LockPanel({ month, locked }: { month: string; locked: boolean }) {
  const { pending, run } = useRunner();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <p className="text-muted-foreground mr-auto max-w-xl">
        {locked
          ? `${month} is locked. Payroll reads these figures.`
          : `Locking ${month} marks every working day without attendance or leave as absent (loss of pay) and freezes the month for payroll.`}
      </p>
      {locked ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => unlockMonthAction({ month }) as Promise<R>, "Month unlocked.")}
        >
          Unlock month
        </Button>
      ) : (
        <Button
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Lock attendance for ${month}? Absent days will be marked.`))
              run(() => lockMonthAction({ month }) as Promise<R>, "Month locked.");
          }}
        >
          Lock month for payroll
        </Button>
      )}
    </div>
  );
}

export function WorkplaceForm({
  lat,
  lng,
  radius,
  weeklyOffs,
}: {
  lat: number | null;
  lng: number | null;
  radius: number | null;
  weeklyOffs: number[];
}) {
  const { pending, run } = useRunner();
  const [offs, setOffs] = useState<number[]>(weeklyOffs);
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (String(f.get(k) ?? "").trim() === "" ? null : Number(f.get(k)));
    run(
      () =>
        saveWorkplaceAction({
          lat: num("lat"),
          lng: num("lng"),
          radiusM: num("radius"),
          weeklyOffs: offs,
        }) as Promise<R>,
      "Workplace saved.",
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="wp-lat">Office latitude</Label>
        <Input
          id="wp-lat"
          name="lat"
          defaultValue={lat ?? ""}
          inputMode="decimal"
          placeholder="12.9716"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="wp-lng">Office longitude</Label>
        <Input
          id="wp-lng"
          name="lng"
          defaultValue={lng ?? ""}
          inputMode="decimal"
          placeholder="77.5946"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="wp-radius">Radius (metres)</Label>
        <Input
          id="wp-radius"
          name="radius"
          defaultValue={radius ?? ""}
          inputMode="numeric"
          placeholder="200"
        />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Weekly offs</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={offs.includes(i)}
                onChange={(e) =>
                  setOffs((o) => (e.target.checked ? [...o, i] : o.filter((x) => x !== i)))
                }
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-muted-foreground text-xs sm:col-span-3">
        Leave latitude, longitude and radius empty to switch the geo-fence off.
      </p>
      <Button type="submit" disabled={pending}>
        Save workplace
      </Button>
    </form>
  );
}

export function ShiftForms({
  shifts,
  employees,
}: {
  shifts: { id: string; name: string; start: string; end: string }[];
  employees: { id: string; name: string }[];
}) {
  const { pending, run } = useRunner();
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          run(
            () =>
              createShiftAction({
                name: f.get("name"),
                startTime: f.get("start"),
                endTime: f.get("end"),
                graceMinutes: Number(f.get("grace") || 10),
              }) as Promise<R>,
            "Shift created.",
            () => form.reset(),
          );
        }}
      >
        <p className="text-sm font-medium">New shift</p>
        <div className="grid grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label htmlFor="sh-name">Name</Label>
            <Input id="sh-name" name="name" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sh-start">Start</Label>
            <Input id="sh-start" name="start" type="time" required defaultValue="09:30" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sh-end">End</Label>
            <Input id="sh-end" name="end" type="time" required defaultValue="18:30" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sh-grace">Grace (min)</Label>
            <Input id="sh-grace" name="grace" type="number" defaultValue={10} min={0} />
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          Create shift
        </Button>
        {shifts.length > 0 && (
          <ul className="text-muted-foreground text-xs">
            {shifts.map((s) => (
              <li key={s.id}>
                {s.name}: {s.start.slice(0, 5)} to {s.end.slice(0, 5)}
              </li>
            ))}
          </ul>
        )}
      </form>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(
            () =>
              assignRosterAction({
                employeeIds: picked,
                shiftId: f.get("shift"),
                from: f.get("from"),
                to: f.get("to"),
              }) as Promise<R>,
            "Roster updated.",
          );
        }}
      >
        <p className="text-sm font-medium">Assign roster</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="ro-shift">Shift</Label>
            <select id="ro-shift" name="shift" className={sel} required>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ro-from">From</Label>
            <Input id="ro-from" name="from" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ro-to">To</Label>
            <Input id="ro-to" name="to" type="date" required />
          </div>
        </div>
        <fieldset className="max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2">
          <legend className="sr-only">Employees</legend>
          {employees.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={picked.includes(e.id)}
                onChange={(ev) =>
                  setPicked((p) => (ev.target.checked ? [...p, e.id] : p.filter((x) => x !== e.id)))
                }
              />
              {e.name}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={pending || picked.length === 0 || shifts.length === 0}>
          Assign
        </Button>
      </form>
    </div>
  );
}

export function ManualForm({ employees }: { employees: { id: string; name: string }[] }) {
  const { pending, run } = useRunner();
  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const form = e.currentTarget;
        run(
          () =>
            manualAttendanceAction({
              employeeId: f.get("emp"),
              date: f.get("date"),
              status: f.get("status"),
              checkIn: f.get("in") || undefined,
              checkOut: f.get("out") || undefined,
              note: f.get("note"),
            }) as Promise<R>,
          "Attendance corrected.",
          () => form.reset(),
        );
      }}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="m-emp">Employee</Label>
        <select id="m-emp" name="emp" className={sel} required>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="m-date">Date</Label>
        <Input id="m-date" name="date" type="date" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="m-status">Status</Label>
        <select id="m-status" name="status" className={sel}>
          <option value="present">Present</option>
          <option value="half_day">Half day</option>
          <option value="absent">Absent</option>
          <option value="leave">Leave</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="m-in">In</Label>
        <Input id="m-in" name="in" type="time" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="m-out">Out</Label>
        <Input id="m-out" name="out" type="time" />
      </div>
      <div className="space-y-1 sm:col-span-5">
        <Label htmlFor="m-note">Reason (required, kept in the audit log)</Label>
        <Input id="m-note" name="note" required minLength={3} />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          Correct
        </Button>
      </div>
    </form>
  );
}
