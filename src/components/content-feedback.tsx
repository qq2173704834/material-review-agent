"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import type { AssistantCitation } from "@/domain/assistant";
export function ContentFeedback({
  id,
  answer,
  citations = [],
}: {
  id?: string;
  answer?: string;
  citations?: AssistantCitation[];
}): ReactElement {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details className="mt-3 text-sm">
      <summary>反馈过期 / 错误内容</summary>
      <p>
        提交后，管理员可看到本次反馈说明{answer ? "、这条回答及引用版本" : "和该资料编号"}
        ，不会查看你的其他私人会话。
      </p>
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const note = String(new FormData(event.currentTarget).get("note"));
          setBusy(true);
          try {
            const response = await fetch("/api/feedback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind: answer ? "回答问题" : "资料问题",
                id,
                note,
                answer,
                citations: citations.map(({ id, version, quote }) => ({ id, version, quote })),
              }),
            });
            if (!response.ok) throw new Error("提交失败或已超限");
            setMessage("反馈已送交内容管理员，处理状态可在个人中心查看。");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "提交失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          问题说明
          <textarea
            name="note"
            required
            minLength={2}
            maxLength={1000}
            className="w-full rounded border p-2"
          />
        </label>
        <button disabled={busy} className="underline">
          提交反馈
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
