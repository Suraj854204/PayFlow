"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { runAction } from "@/lib/action-runner";
import { UserFacingError } from "@/lib/action";
import { employees, expenseClaims } from "@/lib/db/schema";
import { rupeesToPaise } from "@/lib/money";
import { notify } from "@/lib/notify";
import { can } from "@/lib/rbac";
import { uuid } from "@/lib/validation/hr";
import { EXPENSE_CATEGORIES } from "@/lib/validation/expenses";

const PATHS = ["/expenses", "/dashboard", "/payroll"];
const RECEIPT_REQUIRED_ABOVE = 500_00; // paise
const MAX_AMOUNT = 10_00_000_00;
const MAX_RECEIPT = 5 * 1024 * 1024;
const MIME_OK = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function submitExpenseAction(formData: FormData) {
  return runAction(
    "expenses:submit",
    async ({ ctx, tx, audit }) => {
      if (!ctx.employeeId)
        throw new UserFacingError(
          "Your login is not linked to an employee record in this company.",
        );
      const category = z.enum(EXPENSE_CATEGORIES).parse(formData.get("category"));
      const description = z
        .string()
        .trim()
        .max(300)
        .optional()
        .parse(formData.get("description") || undefined);
      let amount: number;
      try {
        amount = rupeesToPaise(String(formData.get("amount") ?? "").replace(/,/g, ""));
      } catch {
        throw new UserFacingError("Enter the amount in rupees, for example 1250 or 1250.50.");
      }
      if (amount <= 0 || amount > MAX_AMOUNT)
        throw new UserFacingError("The amount must be between Rs 0.01 and Rs 10,00,000.");
      const date = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(formData.get("date"));
      const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      if (date > today) throw new UserFacingError("The expense date cannot be in the future.");
      if (date < `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`)
        throw new UserFacingError("Claims older than one year cannot be submitted.");

      let receipt: { name: string; mime: string; data: Buffer } | null = null;
      const file = formData.get("receipt");
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_RECEIPT) throw new UserFacingError("Receipts can be at most 5 MB.");
        if (!MIME_OK.has(file.type))
          throw new UserFacingError("Receipts must be a PDF, PNG or JPG.");
        const buf = Buffer.from(await file.arrayBuffer());
        const head = buf.subarray(0, 4).toString("hex");
        const ok =
          (file.type === "application/pdf" && head === "25504446") ||
          (file.type === "image/png" && head === "89504e47") ||
          (file.type === "image/jpeg" && head.startsWith("ffd8ff"));
        if (!ok) throw new UserFacingError("The receipt contents do not match its type.");
        receipt = {
          name: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120),
          mime: file.type,
          data: buf,
        };
      }
      if (!receipt && amount > RECEIPT_REQUIRED_ABOVE)
        throw new UserFacingError("Attach a receipt for claims above Rs 500.");

      const [row] = await tx
        .insert(expenseClaims)
        .values({
          organizationId: ctx.organizationId,
          employeeId: ctx.employeeId,
          category,
          description,
          amount,
          expenseDate: date,
          receiptName: receipt?.name,
          receiptMime: receipt?.mime,
          receiptData: receipt?.data,
        })
        .returning({ id: expenseClaims.id });
      const [me] = await tx.select().from(employees).where(eq(employees.id, ctx.employeeId));
      if (me?.managerId) {
        const [m] = await tx
          .select({ u: employees.userId })
          .from(employees)
          .where(eq(employees.id, me.managerId));
        await notify(tx, ctx.organizationId, {
          userId: m?.u,
          type: "expense.submitted",
          title: `${me.firstName} submitted an expense claim`,
          href: "/expenses",
        });
      }
      await audit({
        action: "expense.submitted",
        entityType: "expense",
        entityId: row.id,
        newValues: { category, amount, date, receipt: Boolean(receipt) },
      });
      return { id: row.id };
    },
    PATHS,
  );
}

const decideSchema = z.object({
  claimId: uuid,
  approve: z.boolean(),
  note: z.string().trim().max(200).optional(),
});

export async function decideExpenseAction(input: unknown) {
  return runAction(
    "expenses:approve",
    async ({ ctx, tx, audit }) => {
      const d = decideSchema.parse(input);
      await tx.execute(sql`select id from expense_claims where id = ${d.claimId} for update`);
      const [c] = await tx
        .select()
        .from(expenseClaims)
        .where(
          and(
            eq(expenseClaims.id, d.claimId),
            eq(expenseClaims.organizationId, ctx.organizationId),
          ),
        );
      if (!c) throw new UserFacingError("Claim not found.");
      if (c.status !== "submitted")
        throw new UserFacingError("This claim has already been decided.");
      if (c.employeeId === ctx.employeeId)
        throw new UserFacingError(
          "You cannot approve your own claim. Someone else must decide it.",
        );
      const [emp] = await tx.select().from(employees).where(eq(employees.id, c.employeeId));
      // Finance, HR and admins decide any claim; a manager only their reports'.
      const orgWide = can(ctx.role, "payroll:read");
      if (!orgWide && !(emp.managerId && emp.managerId === ctx.employeeId))
        throw new UserFacingError("You can only decide claims from people who report to you.");
      if (!d.approve && !d.note) throw new UserFacingError("Give a reason when rejecting a claim.");
      await tx
        .update(expenseClaims)
        .set({
          status: d.approve ? "approved" : "rejected",
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decisionNote: d.note,
        })
        .where(eq(expenseClaims.id, c.id));
      await notify(tx, ctx.organizationId, {
        userId: emp.userId,
        type: "expense.decided",
        title: d.approve
          ? "Your expense claim was approved and will be paid with the next payroll"
          : "Your expense claim was rejected",
        body: d.note,
        href: "/expenses",
      });
      await audit({
        action: d.approve ? "expense.approved" : "expense.rejected",
        entityType: "expense",
        entityId: c.id,
        oldValues: { status: "submitted" },
        newValues: { status: d.approve ? "approved" : "rejected", amount: c.amount, note: d.note },
      });
      return {};
    },
    PATHS,
  );
}
