"use client";

import { useState } from "react";
import { displayDateTime } from "@/lib/display-date";

import type { ModelCall } from "@/domain/model-call";
import type { ReactElement } from "react";

export function ModelConnectionTest({ canTest }: { canTest: boolean }): ReactElement {
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [call, setCall] = useState<ModelCall | null>(null);
  const [hasError, setHasError] = useState(false);

  async function testConnection(): Promise<void> {
    setIsTesting(true);
    setMessage("");
    setCall(null);
    setHasError(false);
    try {
      const response = await fetch("/api/model/test", { method: "POST" });
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null) throw new Error("Invalid response");
      if (response.ok && "message" in payload && typeof payload.message === "string") {
        setMessage(payload.message);
        if ("call" in payload) setCall(payload.call as ModelCall);
      } else {
        setHasError(true);
        setMessage(
          "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "连接测试失败。",
        );
      }
    } catch {
      setHasError(true);
      setMessage("无法连接本地服务，请确认服务仍在运行。");
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <button
        type="button"
        disabled={!canTest || isTesting}
        onClick={testConnection}
        className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {isTesting ? "正在连接模型…" : "测试模型连接"}
      </button>
      <p className="text-xs leading-6 text-muted-foreground">
        测试只发送一条合成请求，不发送你的任务材料；产生的用量按服务商规则计费。
      </p>
      {message ? (
        <p
          role={hasError ? "alert" : "status"}
          className={`text-sm ${hasError ? "text-red-700" : "text-emerald-800"}`}
        >
          {message}
        </p>
      ) : null}
      {call ? (
        <p className="break-words text-xs leading-6 text-muted-foreground">
          {call.provider} / {call.model} · {displayDateTime(call.completedAt)} · 输入{" "}
          {call.inputTokens ?? "未报告"} / 输出 {call.outputTokens ?? "未报告"} token ·{" "}
          {call.requestCount} 次请求
        </p>
      ) : null}
    </div>
  );
}
