export const RUN_TONE = {
  draft: "neutral",
  review: "warning",
  approved: "primary",
  processing: "primary",
  paid: "success",
  cancelled: "danger",
} as const;

export const PAY_TONE = {
  queued: "neutral",
  processing: "warning",
  processed: "success",
  failed: "danger",
  reversed: "danger",
} as const;

export const RUN_STEPS = ["draft", "review", "approved", "processing", "paid"] as const;
