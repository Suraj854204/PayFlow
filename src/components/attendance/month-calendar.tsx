import { weekday } from "@/lib/attendance/calendar";

export interface DayCell {
  date: string;
  kind: "present" | "half_day" | "absent" | "leave" | "holiday" | "weekly_off" | "none";
  title?: string;
}

const STYLE: Record<DayCell["kind"], string> = {
  present: "bg-success/15 text-success border-success/30",
  half_day: "bg-warning/15 text-warning border-warning/30",
  absent: "bg-destructive/10 text-destructive border-destructive/30",
  leave: "bg-accent text-accent-foreground border-primary/20",
  holiday: "bg-muted text-muted-foreground",
  weekly_off: "bg-muted/50 text-muted-foreground",
  none: "",
};
const LABEL: Record<DayCell["kind"], string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  leave: "Leave",
  holiday: "Holiday",
  weekly_off: "Weekly off",
  none: "No record",
};

export function MonthCalendar({ cells }: { cells: DayCell[] }) {
  const lead = cells.length ? weekday(cells[0].date) : 0;
  return (
    <div>
      <div
        className="text-muted-foreground mb-1 grid grid-cols-7 gap-1 text-center text-xs"
        aria-hidden
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="list" aria-label="Attendance calendar">
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`b${i}`} />
        ))}
        {cells.map((c) => (
          <div
            key={c.date}
            role="listitem"
            title={c.title ?? LABEL[c.kind]}
            aria-label={`${c.date}: ${c.title ?? LABEL[c.kind]}`}
            className={`rounded-md border px-1 py-2 text-center text-xs ${STYLE[c.kind]}`}
          >
            {Number(c.date.slice(8))}
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap gap-3 text-xs">
        {(["present", "half_day", "absent", "leave", "holiday", "weekly_off"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`inline-block size-3 rounded border ${STYLE[k]}`} /> {LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  );
}
