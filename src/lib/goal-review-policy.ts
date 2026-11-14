export function goalReviewPolicy(environment: Record<string, string | undefined>): {
  enabled: boolean;
  dailyLimit: number;
} {
  const limit = Number(environment.AUTO_REVIEW_DAILY_LIMIT ?? 5);
  return {
    enabled: environment.AUTO_REVIEW_ENABLED !== "off",
    dailyLimit: Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 5,
  };
}
