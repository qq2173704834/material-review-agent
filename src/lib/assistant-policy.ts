export function assistantPolicy(environment: Record<string, string | undefined>): {
  enabled: boolean;
  hourlyLimit: number;
} {
  const limit = Number(environment.ASSISTANT_HOURLY_LIMIT ?? 20);
  return {
    enabled: environment.ASSISTANT_ENABLED !== "off",
    hourlyLimit: Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 20,
  };
}
