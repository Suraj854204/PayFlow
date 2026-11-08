"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Save } from "lucide-react";
import { toast } from "sonner";
import { runPipelineNowAction, savePipelineAction } from "@/app/actions/workflows";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { STEP_LABEL, type StepName } from "@/lib/pipeline/labels";

export function PipelineForm({
  initial,
}: {
  initial: { enabled: boolean; startDay: number; reminderHours: number };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [startDay, setStartDay] = useState(String(initial.startDay));
  const [reminderHours, setReminderHours] = useState(String(initial.reminderHours));
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await savePipelineAction({
            enabled,
            startDay: Number(startDay),
            reminderHours: Number(reminderHours),
          });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Saved.");
            router.refresh();
          }
        });
      }}
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4"
        />
        Prepare payroll automatically every month
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pl-day">Start on day of the month (1 to 28)</Label>
          <Input
            id="pl-day"
            type="number"
            min={1}
            max={28}
            value={startDay}
            onChange={(e) => setStartDay(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pl-rem">Remind approvers after (hours)</Label>
          <Input
            id="pl-rem"
            type="number"
            min={1}
            max={168}
            value={reminderHours}
            onChange={(e) => setReminderHours(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          <Save /> Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await runPipelineNowAction();
              if (!r.ok) return void toast.error(r.error);
              const d = r.data.stoppedAt;
              toast.success(
                d === "complete"
                  ? "Every step is finished."
                  : `Stopped at: ${STEP_LABEL[d as StepName]}. See details below.`,
              );
              router.refresh();
            })
          }
        >
          <Play /> Run now for last month
        </Button>
      </div>
    </form>
  );
}
