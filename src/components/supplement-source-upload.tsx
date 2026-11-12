"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { FormEvent, ReactElement } from "react";

interface SupplementSourceUploadProps {
  taskId: string;
}

export function SupplementSourceUpload({ taskId }: SupplementSourceUploadProps): ReactElement {
  const router = useRouter();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceMode, setSourceMode] = useState<"file" | "webpage">("file");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submitSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sourceMode === "file" && !sourceFile) return;
    const form = event.currentTarget;
    setError("");
    setIsSaving(true);
    const formData = new FormData();
    if (sourceMode === "file" && sourceFile) formData.set("sourceFile", sourceFile);
    try {
      const response = await fetch(`/api/tasks/${taskId}/sources`, {
        method: "POST",
        headers: sourceMode === "webpage" ? { "Content-Type": "application/json" } : undefined,
        body: sourceMode === "webpage" ? JSON.stringify({ sourceUrl }) : formData,
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "补充来源添加失败。";
        setError(message);
        return;
      }
      setSourceFile(null);
      setSourceUrl("");
      form.reset();
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请确认服务仍在运行后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className="mt-8 max-w-4xl border-t border-border pt-5"
      aria-labelledby="supplement-sources-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="supplement-sources-heading" className="text-sm font-semibold">
            补充要求来源
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            附件、补充通知或更正文件会独立保存，不覆盖主通知。
          </p>
        </div>
        <form onSubmit={submitSource} className="flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-border" role="group" aria-label="补充来源类型">
            <button
              type="button"
              aria-pressed={sourceMode === "file"}
              onClick={() => setSourceMode("file")}
              className={`h-9 px-3 text-xs ${sourceMode === "file" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              文件
            </button>
            <button
              type="button"
              aria-pressed={sourceMode === "webpage"}
              onClick={() => setSourceMode("webpage")}
              className={`h-9 border-l border-border px-3 text-xs ${sourceMode === "webpage" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              网页
            </button>
          </div>
          {sourceMode === "file" ? (
            <>
              <label className="sr-only" htmlFor="supplement-source-file">
                选择补充来源文件
              </label>
              <input
                id="supplement-source-file"
                type="file"
                required
                accept=".pdf,.docx,.txt"
                onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
                className="max-w-full text-xs file:mr-2 file:border file:border-border file:bg-background file:px-2 file:py-1"
              />
            </>
          ) : (
            <>
              <label className="sr-only" htmlFor="supplement-source-url">
                补充网页 URL
              </label>
              <input
                id="supplement-source-url"
                type="url"
                required
                maxLength={2048}
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://example.org/attachment"
                className="h-9 min-w-56 border border-border bg-background px-2 text-xs"
              />
            </>
          )}
          <button
            type="submit"
            disabled={isSaving || (sourceMode === "file" ? !sourceFile : !sourceUrl.trim())}
            className="h-9 border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {isSaving ? (sourceMode === "webpage" ? "正在读取…" : "正在解析…") : "添加来源"}
          </button>
        </form>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
