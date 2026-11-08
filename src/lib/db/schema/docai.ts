import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { users } from "./auth";
import { employees } from "./hr";
import { organizations } from "./tenancy";

/**
 * A document read by AI (or typed in by hand) and waiting for a person to verify it. The extracted
 * values are encrypted at rest; the uploaded file itself is never stored.
 */
export const documentExtractions = pgTable(
  "document_extractions",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    status: text("status").notNull().default("review"),
    /** AES-GCM encrypted JSON of the field values. */
    fieldsEnc: text("fields_enc").notNull(),
    engine: text("engine").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    verifiedBy: text("verified_by").references(() => users.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("document_extractions_emp_idx").on(t.organizationId, t.employeeId, t.createdAt),
    check("document_extractions_kind", sql`${t.kind} in ('pan','aadhaar','bank_proof','resume')`),
    check("document_extractions_status", sql`${t.status} in ('review','verified','rejected')`),
    check("document_extractions_engine", sql`${t.engine} in ('model','manual')`),
  ],
);
