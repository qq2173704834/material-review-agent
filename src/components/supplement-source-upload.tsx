"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUploadQueue } from "@/lib/use-upload-queue";
import { UploadQueue } from "@/components/upload-queue";
import { useTaskWorkflow } from "@/components/task-workspace";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { FormEvent, ReactElement } from "react";

export function SupplementSourceUpload({ taskId }: { taskId: string }): ReactElement {
  const router = useRouter();
  const workflow = useTaskWorkflow();
  const queue = useUploadQueue(taskId, "sources");
  const [sourceMode, setSourceMode] = useState<"file" | "webpage">("file");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const clearUnsaved = useUnsavedChanges(Boolean(sourceUrl.trim()));
  async function submitSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving || !sourceUrl.trim()) return;
    setError("");
    setIsSaving(true);
    workflow?.setActivity("source-webpage", "正在读取审查依据网页");
    try {
      const response = await fetch(`/api/tasks/${taskId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        setError(
          typeof result === "object" &&
            result &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "网页未能添加，请重试或粘贴正文。",
        );
        return;
      }
      setSourceUrl("");
      clearUnsaved();
      router.refresh();
    } catch {
      setError("服务暂时不可用，地址已保留，请重试。");
    } finally {
      setIsSaving(false);
      workflow?.setActivity("source-webpage", null);
    }
  }
  return (
    <section className="mt-6 border-t pt-5" aria-labelledby="supplement-sources-heading">
      <h3 id="supplement-sources-heading" className="text-sm font-semibold">
        补充要求来源
      </h3>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        附件、补充通知或更正文件独立保存。同名内容有变化时，会引导修订并保留旧版本。
      </p>
      <div role="group" aria-label="补充来源类型" className="my-3 flex gap-2">
        <button
          type="button"
          aria-pressed={sourceMode === "file"}
          onClick={() => setSourceMode("file")}
          className="min-h-11 rounded-lg border px-4 text-xs"
        >
          文件
        </button>
        <button
          type="button"
          aria-pressed={sourceMode === "webpage"}
          onClick={() => setSourceMode("webpage")}
          className="min-h-11 rounded-lg border px-4 text-xs"
        >
          网页
        </button>
      </div>
      <div
        hidden={sourceMode !== "file"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          queue.enqueue(Array.from(event.dataTransfer.files));
        }}
        className="rounded-xl border-2 border-dashed p-3"
      >
        <label htmlFor="supplement-source-file" className="text-xs">
          选择或拖入 PDF、DOCX、TXT 通知文件，自动读取
        </label>
        <input
          id="supplement-source-file"
          aria-label="选择补充来源文件"
          type="file"
          multiple
          accept=".pdf,.docx,.txt"
          onChange={(event) => {
            queue.enqueue(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
          className="mt-3 min-h-11 w-full min-w-0 text-xs file:min-h-11 file:rounded file:border file:px-2"
        />
      </div>
      <UploadQueue {...queue} />
      <form hidden={sourceMode !== "webpage"} onSubmit={submitSource} className="space-y-3">
        <label className="block text-xs">
          补充网页 URL
          <input
            type="url"
            required
            maxLength={2048}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://example.org/notice"
            className="mt-2 min-h-11 w-full min-w-0 rounded-lg border px-3 text-sm"
          />
        </label>
        <button
          disabled={isSaving || !sourceUrl.trim()}
          className="min-h-11 rounded-lg border px-4 text-xs disabled:opacity-50"
        >
          {isSaving ? "正在读取…" : "读取并添加网页"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
