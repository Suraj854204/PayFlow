"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { createEmployeeAction, updateEmployeeAction } from "@/app/actions/employees";
import { INDIAN_STATES } from "@/lib/validation/hr";

export interface EmployeeFormValues {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  joinDate: string;
  probationEndDate: string;
  employmentType: string;
  departmentId: string;
  designationId: string;
  managerId: string;
  workState: string;
  taxRegime: string;
  bankIfsc: string;
  bankName: string;
  uan: string;
  esiNumber: string;
  panMasked?: string | null;
  aadhaarMasked?: string | null;
  bankAccountMasked?: string | null;
}

interface Props {
  employeeId?: string;
  initial: EmployeeFormValues;
  departments: { id: string; name: string }[];
  designations: { id: string; title: string }[];
  managers: { id: string; name: string }[];
}

const select = "bg-card h-10 w-full rounded-lg border px-3 text-sm";

export function EmployeeForm({ employeeId, initial, departments, designations, managers }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<
      string,
      string
    >;
    // Empty selects/inputs are sent as undefined so optional fields stay unset.
    const payload = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
    );
    start(async () => {
      const res = employeeId
        ? await updateEmployeeAction(employeeId, payload)
        : await createEmployeeAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(
        employeeId ? "Employee updated." : "Employee created with an onboarding checklist.",
      );
      const id = employeeId ?? (res.data as { id: string }).id;
      router.push(`/employees/${id}`);
      router.refresh();
    });
  }

  const field = (
    name: keyof EmployeeFormValues | "pan" | "aadhaar" | "bankAccount",
    label: string,
    opts: {
      type?: string;
      required?: boolean;
      placeholder?: string;
      hint?: string;
      defaultValue?: string;
    } = {},
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {opts.required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={opts.type ?? "text"}
        required={opts.required}
        placeholder={opts.placeholder}
        defaultValue={
          opts.defaultValue ?? (initial as unknown as Record<string, string>)[name] ?? ""
        }
        aria-invalid={!!errors[name]}
        autoComplete="off"
      />
      {opts.hint && !errors[name] && <p className="text-muted-foreground text-xs">{opts.hint}</p>}
      <FieldError message={errors[name]?.[0]} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <Section title="Basics">
        {field("employeeCode", "Employee code", { required: true, placeholder: "E101" })}
        {field("email", "Work email", { type: "email", required: true })}
        {field("firstName", "First name", { required: true })}
        {field("lastName", "Last name")}
        {field("phone", "Phone")}
        <div className="space-y-1.5">
          <Label htmlFor="gender">Gender</Label>
          <select id="gender" name="gender" defaultValue={initial.gender} className={select}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </div>
        {field("dateOfBirth", "Date of birth", { type: "date" })}
      </Section>

      <Section title="Employment">
        {field("joinDate", "Join date", { type: "date", required: true })}
        {field("probationEndDate", "Probation ends", {
          type: "date",
          hint: "Defaults to 6 months after joining.",
        })}
        <div className="space-y-1.5">
          <Label htmlFor="employmentType">Type</Label>
          <select
            id="employmentType"
            name="employmentType"
            defaultValue={initial.employmentType}
            className={select}
          >
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workState">Work state (Professional Tax)</Label>
          <select
            id="workState"
            name="workState"
            defaultValue={initial.workState}
            className={select}
          >
            <option value="">Select state</option>
            {INDIAN_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="taxRegime">Income tax regime (TDS)</Label>
          <select
            id="taxRegime"
            name="taxRegime"
            defaultValue={initial.taxRegime || "new"}
            className={select}
          >
            <option value="new">New regime (default)</option>
            <option value="old">Old regime</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="departmentId">Department</Label>
          <select
            id="departmentId"
            name="departmentId"
            defaultValue={initial.departmentId}
            className={select}
          >
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="designationId">Designation</Label>
          <select
            id="designationId"
            name="designationId"
            defaultValue={initial.designationId}
            className={select}
          >
            <option value="">None</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="managerId">Reports to</Label>
          <select
            id="managerId"
            name="managerId"
            defaultValue={initial.managerId}
            className={select}
          >
            <option value="">No manager</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <FieldError message={errors.managerId?.[0]} />
        </div>
      </Section>

      <Section
        title="Identity and bank"
        note="Encrypted at rest. Leave a field blank to keep its current value."
      >
        {field("pan", "PAN", { placeholder: initial.panMasked ?? "ABCDE1234F", defaultValue: "" })}
        {field("aadhaar", "Aadhaar", {
          placeholder: initial.aadhaarMasked ?? "12 digits",
          defaultValue: "",
        })}
        {field("bankAccount", "Bank account number", {
          placeholder: initial.bankAccountMasked ?? "",
          defaultValue: "",
        })}
        {field("bankIfsc", "IFSC", { placeholder: "HDFC0001234" })}
        {field("bankName", "Bank name")}
        {field("uan", "UAN (PF)")}
        {field("esiNumber", "ESI number")}
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : employeeId ? "Save changes" : "Create employee"}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold">{title}</legend>
      {note && <p className="text-muted-foreground -mt-2 text-xs">{note}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
