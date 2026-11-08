"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { giveRecognitionAction } from "@/app/actions/engagement";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

const VALUES: Record<string, string> = {
  teamwork: "Teamwork",
  ownership: "Ownership",
  customer_focus: "Customer focus",
  innovation: "Innovation",
  going_extra_mile: "Going the extra mile",
};

export function GiveForm({ colleagues }: { colleagues: { id: string; name: string }[] }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [value, setValue] = useState("teamwork");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await giveRecognitionAction({ toEmployeeId: to, value, message });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Recognition sent.");
          setMessage("");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rc-to">Who</Label>
          <select
            id="rc-to"
            required
            className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Choose a colleague</option>
            {colleagues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rc-value">For</Label>
          <select
            id="rc-value"
            className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            {Object.entries(VALUES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="rc-msg">Say thanks</Label>
        <Input
          id="rc-msg"
          maxLength={280}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What did they do?"
          required
        />
      </div>
      <Button type="submit" disabled={pending || !to || message.trim().length < 3}>
        <Heart /> Send
      </Button>
    </form>
  );
}
