"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ReactElement } from "react";
import type { ScheduleNode } from "@/lib/schedule";
import {
  scheduleOverdue,
  scheduleCountdown,
  formatScheduleTime,
  missingScheduleDateLabel,
} from "@/lib/schedule";
import { notifyScheduleChanged } from "@/components/schedule-refresh";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

export function ScheduleExamCard({ node, now }: { node: ScheduleNode; now: number }): ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [editingBase, setEditingBase] = useState({
    revision: node.revision,
    sourceValue: node.sourceValue,
  });
  useUnsavedChanges(editing && value !== node.value, true);
  async function send(
    command:
      { action: "done"; done: boolean } | { action: "date"; value: string } | { action: "reset" },
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: node.id,
          expectedRevision: command.action === "date" ? editingBase.revision : node.revision,
          sourceValue: command.action === "date" ? editingBase.sourceValue : node.sourceValue,
          command,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEditing(false);
      notifyScheduleChanged();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      id={encodeURIComponent(node.id)}
      className="space-y-3 rounded-2xl border bg-card p-4"
      aria-label={node.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-primary">公共考试 · {node.label}</span>
        <span className="rounded-full bg-muted px-3 py-1">
          {node.done
            ? "已完成"
            : !node.value
              ? missingScheduleDateLabel(node)
              : scheduleOverdue(node.value, now)
                ? "已到期 · 待完成"
                : scheduleCountdown(node.value, now)}
        </span>
      </div>
      <h3
        className={`font-semibold break-words ${node.done ? "line-through text-muted-foreground" : ""}`}
      >
        {node.title}
      </h3>
      {node.value && (
        <p className="text-sm text-muted-foreground">
          {formatScheduleTime(node.value)}
          {node.value.length === 10 ? " · 仅日期" : " · 北京时间"}
          {node.manual ? " · 我的安排" : ""}
        </p>
      )}
      {node.changed && (
        <p className="text-sm text-amber-700">
          来源安排有变化，请核对。你填写的时间仍保留，重新确认后使用。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={node.href} className="button-secondary">
          {node.missingDateReason === "edition-unselected"
            ? "选择考期"
            : node.missingDateReason === "source-unlinked"
              ? "关联考试公告"
              : "查看来源"}
        </Link>
        <button
          disabled={busy}
          className="button-secondary"
          onClick={() => void send({ action: "done", done: !node.done })}
        >
          {node.done ? "恢复待办" : "完成"}
        </button>
        <button
          disabled={busy}
          className="button-secondary"
          onClick={() => {
            setValue(node.manualValue ?? node.value);
            setEditingBase({ revision: node.revision, sourceValue: node.sourceValue });
            setEditing(!editing);
          }}
        >
          调整日期
        </button>
        {(node.manual || node.changed) && (
          <button
            disabled={busy}
            className="button-secondary"
            onClick={() => void send({ action: "reset" })}
          >
            采用来源安排
          </button>
        )}
        {node.goalIds.map((id) => (
          <Link
            key={id}
            href={`/me/preparation?goal=${id}`}
            className="text-sm text-primary self-center"
          >
            查看目标 →
          </Link>
        ))}
      </div>
      {editing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ action: "date", value });
          }}
        >
          <label className="text-sm flex-1 min-w-0">
            我的安排日期
            <input
              className="mt-1 min-h-11 w-full rounded-xl border p-2"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="2027-01-06 或 2027-01-06T09:00；留空为待定"
            />
          </label>
          <button disabled={busy} className="button-primary">
            {busy ? "保存中…" : "保存日期"}
          </button>
          <button type="button" className="button-secondary" onClick={() => setEditing(false)}>
            取消
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          <button className="ml-2 underline" onClick={() => router.refresh()}>
            重新读取
          </button>
        </p>
      )}
    </article>
  );
}
