import { createHash } from "node:crypto";

export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");
