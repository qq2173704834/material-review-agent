"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import type { RemediationTask } from "@/domain/review";

export function RemediationAssignment({
  taskId,
  todo,
  onUpdated,
}: {
  taskId: string;
  todo: RemediationTask;
  onUpdated: (todo: RemediationTask) => void;
}): ReactElement {
  const router = useRouter();
  const [assignee, setAssignee] = useState(todo.assignee ?? "");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(claim = false): Promise<void> {
    setBusy(true);
    try {
      let selectedAssignee = assignee;
      let selectedNote = note;
      if (claim) {
        const access = await (await fetch("/api/access")).json();
        if (typeof access.identity !== "string") {
          setMessage("请先登录访问身份后认领。");
          return;
        }
        selectedAssignee = access.identity === "local" ? "本机用户" : access.identity;
        selectedNote = note || "当前身份主动认领待办";
        setAssignee(selectedAssignee);
      }
      const response = await fetch(`/api/tasks/${taskId}/remediations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: todo.id, assignee: selectedAssignee, note: selectedNote }),
      });
      setMessage(response.ok ? "分工已保存。" : "分工保存失败。");
      if (response.ok) {
        const payload = (await response.json()) as { remediationTask: RemediationTask };
        onUpdated(payload.remediationTask);
        router.refresh();
      }
    } catch {
      setMessage("请求失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mt-2 text-xs">
      <summary className="min-h-11 cursor-pointer">
        负责人/认领：{todo.assignee || "未分配"}
      </summary>
      <label>
        负责人
        <input
          aria-label={`${todo.ruleCode} 负责人`}
          className="block min-h-11 rounded border p-2"
          maxLength={80}
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
        />
      </label>
      <label>
        分工说明
        <input
          className="block min-h-11 rounded border p-2"
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button disabled={busy} onClick={() => void save()} className="min-h-11 rounded border px-3">
        保存分工 / 认领
      </button>
      <button
        disabled={busy}
        onClick={() => void save(true)}
        className="ml-2 min-h-11 rounded border px-3"
      >
        由我认领
      </button>
      <p role="status">{message}</p>
      <ul>
        {todo.assignmentHistory?.map((item, index) => (
          <li key={index}>
            {item.at} · {item.assignee || "解除分配"} · {item.note}
          </li>
        ))}
      </ul>
      <p>本地协作记录，填写姓名不会授予账户访问权限。</p>
    </details>
  );
}
