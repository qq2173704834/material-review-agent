export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.REVIEW_AUTH_MODE === "legacy-test" ||
    process.env.EXAM_SCHEDULER === "off"
  )
    return;
  const { goalReviewTick } = await import("@/lib/server/goal-review");
  const { collectorTick } = await import("@/lib/server/exam-collector");
  const state = globalThis as typeof globalThis & { __examTimer?: ReturnType<typeof setInterval> };
  if (!state.__examTimer) {
    void collectorTick().catch(() => undefined);
    void goalReviewTick().catch(() => undefined);
    state.__examTimer = setInterval(() => {
      void collectorTick().catch(() => undefined);
      void goalReviewTick().catch(() => undefined);
    }, 60000);
    state.__examTimer.unref();
  }
}
