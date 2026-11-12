import "server-only";

import { z } from "zod";
import { getModelConfiguration } from "@/lib/server/model-client";

const runtimeEnvironmentSchema = z.object({
  AI_MODE: z.enum(["mock", "live"]).default("mock"),
});

export interface RuntimeStatus {
  mode: "mock" | "live" | "invalid";
  hasModelConfiguration: boolean;
  modelIntegration: "implemented";
  storage: "not_initialized" | "local_sqlite";
}

/** 只返回白名单状态；此函数不连接模型，也不返回密钥或服务地址。 */
export function getRuntimeStatus(hasLocalStorage = false): RuntimeStatus {
  const validation = runtimeEnvironmentSchema.safeParse({ AI_MODE: process.env.AI_MODE });
  let hasModelConfiguration = false;
  try {
    getModelConfiguration();
    hasModelConfiguration = true;
  } catch {
    /* 只返回配置状态，不返回原始配置或密钥。 */
  }

  return {
    mode: validation.success ? validation.data.AI_MODE : "invalid",
    hasModelConfiguration,
    modelIntegration: "implemented",
    storage: hasLocalStorage ? "local_sqlite" : "not_initialized",
  };
}
