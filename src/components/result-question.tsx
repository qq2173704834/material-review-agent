"use client";
import { useState } from "react";
import type { ReactElement } from "react";

export function ResultQuestion({
  taskId,
  executionId,
  ruleId,
}: {
  taskId: string;
  executionId: string;
  ruleId: string;
}): ReactElement {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  async function ask(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId, ruleId, question }),
      });
      const payload = await response.json();
      setAnswer(response.ok ? payload.answer : payload.error);
    } catch {
      setAnswer("请求失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mt-3 text-xs">
      <summary className="min-h-11 cursor-pointer text-primary">追问这项结论</summary>
      <label className="block">
        你的问题
        <input
          value={question}
          maxLength={1000}
          onChange={(event) => setQuestion(event.target.value)}
          className="my-2 block min-h-11 w-full rounded border p-2"
        />
      </label>
      <button
        disabled={busy || !question.trim()}
        onClick={() => void ask()}
        className="min-h-11 rounded border px-3"
      >
        {busy ? "正在解释…" : "获取依据解释"}
      </button>
      <p className="mt-2 whitespace-pre-wrap" role="status">
        {answer}
      </p>
      <p>解释仅使用本次执行已保存的依据，不修改原判定。</p>
    </details>
  );
}
