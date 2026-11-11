import "server-only";

import { z } from "zod";

const runtimeEnvironmentSchema = z.object({
  AI_MODE: z.enum(["mock", "live"]).default("mock"),
});

export interface RuntimeStatus {
  mode: "mock" | "live" | "invalid";
  hasModelConfiguration: boolean;
  modelIntegration: "not_implemented";
  storage: "not_initialized" | "local_sqlite";
}

/** 只返回白名单状态；此函数不连接模型，也不返回密钥或服务地址。 */
export function getRuntimeStatus(hasLocalStorage = false): RuntimeStatus {
  const validation = runtimeEnvironmentSchema.safeParse({ AI_MODE: process.env.AI_MODE });
  const hasModelConfiguration = [
    process.env.AI_BASE_URL,
    process.env.AI_MODEL,
    process.env.AI_API_KEY,
  ].every((value) => Boolean(value?.trim()));

  return {
    mode: validation.success ? validation.data.AI_MODE : "invalid",
    hasModelConfiguration,
    modelIntegration: "not_implemented",
    storage: hasLocalStorage ? "local_sqlite" : "not_initialized",
  };
}
