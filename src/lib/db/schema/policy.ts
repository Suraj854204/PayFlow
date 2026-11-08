import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_helpers";
import { users } from "./auth";
import { organizations } from "./tenancy";

const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/** An uploaded HR policy (PDF or text). Chunks are what gets searched and cited. */
export const policyDocuments = pgTable(
  "policy_documents",
  {
    id: id(),
    organizationId: orgRef(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    pages: integer("pages").notNull().default(1),
    chunkCount: integer("chunk_count").notNull().default(0),
    /** "embedded" when semantic vectors were stored, "keyword" when only full-text search is available. */
    indexMode: text("index_mode").notNull().default("keyword"),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("policy_documents_org_idx").on(t.organizationId, t.createdAt)],
);

/**
 * A passage of a policy. The `embedding vector(768)` column and its HNSW index are added by
 * drizzle/rls.sql when the pgvector extension is available; full-text search works either way.
 */
export const policyChunks = pgTable(
  "policy_chunks",
  {
    id: id(),
    organizationId: orgRef(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => policyDocuments.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    page: integer("page").notNull().default(1),
    content: text("content").notNull(),
  },
  (t) => [index("policy_chunks_doc_idx").on(t.documentId, t.idx)],
);
