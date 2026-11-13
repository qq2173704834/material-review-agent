"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTaskActivity } from "@/components/task-workspace";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { RequirementSourceVersion } from "@/domain/review";
import type { ReactElement } from "react";

export function SourceEditor({
  taskId,
  source,
}: {
  taskId: string;
  source: RequirementSourceVersion;
}): ReactElement {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState(source.originalText);
  const [note, setNote] = useState("");
  const [complete, setComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  useTaskActivity(
    `source-editor-${source.id}`,
    isSaving
      ? "正在保存来源修订"
      : isOpen && (text !== source.originalText || !!note)
        ? "请先保存或取消来源修订"
        : null,
  );
  const clearUnsaved = useUnsavedChanges(isOpen && (text !== source.originalText || !!note));
  async function save(): Promise<void> {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: source.version, text, note, confirmedComplete: complete }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "保存失败，输入已保留。");
        return;
      }
      clearUnsaved();
      router.refresh();
    } catch {
      setError("无法连接本地服务，输入已保留。");
    } finally {
      setIsSaving(false);
    }
  }
  return (
    <details className="w-full" onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-primary">修订来源文字 / 更新要求</summary>
      {isOpen && (
        <div className="my-2 space-y-2 rounded border p-3">
          <p>
            保存为新来源版本，使规则和旧结果待更新。旧执行中的原文保持不变；可粘贴新通知正文或纠正识别错误。
          </p>
          <label className="block">
            来源正文
            <textarea
              aria-label="修订来源正文"
              className="block min-h-40 w-full rounded border p-2"
              value={text}
              maxLength={200000}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="block">
            修订依据
            <input
              aria-label="来源修订依据"
              className="block min-h-11 w-full rounded border p-2"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={complete}
              onChange={(event) => setComplete(event.target.checked)}
            />
            已对照原文核对本次正文完整（人工确认）
          </label>
          <button
            className="min-h-11 rounded border px-3"
            disabled={isSaving || !note.trim() || !text.trim()}
            onClick={save}
          >
            {isSaving ? "正在保存…" : "保存来源新版本"}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
