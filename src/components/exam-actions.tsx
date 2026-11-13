"use client";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useState } from "react";
export function ExamActions({
  id,
  saved = false,
  withdrawn = false,
}: {
  id: string;
  saved?: boolean;
  withdrawn?: boolean;
}): ReactElement {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [isSaved, setSaved] = useState(saved);
  async function act(action: string, extra: Record<string, string> = {}): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/exams/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error);
        return;
      }
      if (payload.taskId) {
        router.replace(`/tasks/${payload.taskId}`);
        return;
      }
      if (action === "favorite" || action === "unfavorite") setSaved(action === "favorite");
      setMessage(payload.message ?? "已保存。");
    } catch {
      setMessage("网络失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <button
        className="rounded border px-4 py-2"
        disabled={busy}
        onClick={() => void act(isSaved ? "unfavorite" : "favorite")}
      >
        {isSaved ? "取消收藏" : "收藏公告"}
      </button>
      {!withdrawn && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<
              string,
              string
            >;
            void act("task", values);
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label>
            预审阶段
            <select name="stage" className="ml-2 rounded border p-2">
              <option>报名</option>
              <option>资格复审</option>
              <option>其他</option>
            </select>
          </label>
          <label>
            岗位 / 科目
            <input
              name="target"
              placeholder="不明确可填待确认"
              maxLength={200}
              className="ml-2 rounded border p-2"
            />
          </label>
          <button disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
            用此公告预审材料
          </button>
          <p className="w-full text-sm">
            将保存当前正文版本。附件未读取，创建后请按需逐份导入；不同岗位的条件需单独核对。
          </p>
        </form>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
export function LinkVersionActions({
  noticeId,
  taskId,
}: {
  noticeId: string;
  taskId: string;
}): ReactElement {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <button
        disabled={busy}
        className="rounded border p-2"
        onClick={async () => {
          setBusy(true);
          try {
            const response = await fetch(`/api/exams/${noticeId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "adopt", taskId }),
            });
            const payload = await response.json();
            setMessage(payload.message ?? payload.error ?? "已保存");
          } catch {
            setMessage("操作未完成，请重试。");
          } finally {
            setBusy(false);
          }
        }}
      >
        已核对，采用新版作为补充来源
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
