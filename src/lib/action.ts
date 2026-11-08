import { z } from "zod";
import { ForbiddenError } from "@/lib/rbac";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/** Converts anything thrown inside a server action into a safe, typed result. */
export function toActionError(err: unknown): {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[] | undefined>;
} {
  if (err instanceof z.ZodError) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: z.flattenError(err).fieldErrors as Record<string, string[] | undefined>,
    };
  }
  if (err instanceof ForbiddenError)
    return { ok: false, error: "You do not have permission to do that." };
  if (err instanceof Error && err.name === "UnauthorizedError")
    return { ok: false, error: "Please sign in again." };
  if (err instanceof Error && err.name === "UserFacingError")
    return { ok: false, error: err.message };
  console.error("[action]", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
