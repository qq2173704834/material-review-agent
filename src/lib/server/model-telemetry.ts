import "server-only";
import { mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelCall } from "@/domain/model-call";
/** Separate operational ledger: no provider URL, model configuration, identities or document content. */
export function recordModelOperation(call: ModelCall): void {
  try {
    const directory = resolve(
      process.env.REVIEW_DATA_DIR?.trim() || resolve(process.cwd(), ".local-data"),
      "operations",
    );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const record = {
      type: "model_call",
      operation: call.operation,
      startedAt: call.startedAt,
      completedAt: call.completedAt,
      status: call.status,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      requestCount: call.requestCount,
      errorCode: call.errorCode,
    };
    appendFileSync(
      resolve(directory, `model-${new Date().toISOString().slice(0, 10)}.jsonl`),
      JSON.stringify(record) + "\n",
      { mode: 0o600 },
    );
  } catch {
    console.warn("model_telemetry_write_failed");
  }
}
