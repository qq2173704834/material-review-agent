"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ReviewMaterialSummary } from "@/domain/review";
import type { ReactElement, ChangeEvent } from "react";

interface MaterialUploadProps {
  taskId: string;
  initialMaterials: ReviewMaterialSummary[];
}

const statusLabels = {
  text_extracted: "已提取文本",
  partial: "部分解析",
  failed: "解析失败",
  ocr_required: "需要 OCR",
} as const;

interface MaterialUploadResult {
  id: string;
  version: number;
  originalFileName: string;
  parseStatus: ReviewMaterialSummary["parseStatus"];
  parseMessage: string;
}

function formatBytes(fileSizeBytes: number): string {
  return fileSizeBytes < 1024 * 1024
    ? `${Math.max(1, Math.round(fileSizeBytes / 1024))} KiB`
    : `${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function MaterialUpload({ taskId, initialMaterials }: MaterialUploadProps): ReactElement {
  const router = useRouter();
  const [materials, setMaterials] = useState(initialMaterials);
  const [uploadResults, setUploadResults] = useState<MaterialUploadResult[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  function selectFiles(event: ChangeEvent<HTMLInputElement>): void {
    setSelectedFiles(Array.from(event.currentTarget.files ?? []));
    setUploadResults([]);
    setError("");
  }

  async function uploadFiles(): Promise<void> {
    if (!selectedFiles.length) return;
    setIsUploading(true);
    setError("");
    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    try {
      const response = await fetch(`/api/tasks/${taskId}/materials`, {
        method: "POST",
        body: formData,
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("materials" in payload)
      ) {
        setError(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "上传失败，请重试。",
        );
        return;
      }
      if (
        !Array.isArray(payload.materials) ||
        payload.materials.some(
          (item) =>
            typeof item !== "object" ||
            item === null ||
            !("id" in item) ||
            typeof item.id !== "string" ||
            !("version" in item) ||
            typeof item.version !== "number" ||
            !("originalFileName" in item) ||
            typeof item.originalFileName !== "string" ||
            !("parseStatus" in item) ||
            typeof item.parseStatus !== "string" ||
            !Object.hasOwn(statusLabels, item.parseStatus) ||
            !("parseMessage" in item) ||
            typeof item.parseMessage !== "string",
        )
      ) {
        setError("服务返回的逐文件上传结果无法识别。");
        return;
      }
      setUploadResults(payload.materials as MaterialUploadResult[]);
      const refreshed = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
      const taskPayload: unknown = await refreshed.json();
      if (
        refreshed.ok &&
        typeof taskPayload === "object" &&
        taskPayload !== null &&
        "task" in taskPayload
      ) {
        const task = taskPayload.task as { materials?: ReviewMaterialSummary[] };
        setMaterials(task.materials ?? []);
      }
      setSelectedFiles([]);
      const input = document.getElementById("material-files") as HTMLInputElement | null;
      if (input) input.value = "";
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section
      aria-labelledby="materials-heading"
      className="mt-12 max-w-4xl border-t border-border pt-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="materials-heading" className="text-sm font-semibold">
            审查材料
          </h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            支持 PDF、DOCX、TXT、XLSX、CSV、JPG、PNG；单文件最多 20 MiB，每批最多 10 个文件。
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          id="material-files"
          aria-label="选择审查材料"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.xlsx,.csv,.jpg,.jpeg,.png"
          onChange={selectFiles}
          className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-xs file:font-medium"
        />
        <button
          type="button"
          onClick={uploadFiles}
          disabled={!selectedFiles.length || isUploading}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {isUploading ? "正在上传…" : `上传 ${selectedFiles.length || "材料"}`}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {uploadResults.length > 0 ? (
        <ul
          aria-label="本批上传结果"
          className="mt-4 divide-y divide-border border-y border-border"
        >
          {uploadResults.map((result) => (
            <li
              key={result.id}
              className="flex flex-wrap items-start justify-between gap-2 py-3 text-xs"
            >
              <span className="min-w-0 break-words font-medium">
                {result.originalFileName} · v{result.version}
                {result.parseMessage ? (
                  <span className="mt-1 block font-normal leading-5 text-amber-800">
                    {result.parseMessage}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {statusLabels[result.parseStatus]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {materials.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">尚未上传材料。</p>
      ) : (
        <ul className="mt-5 divide-y divide-border border-y border-border">
          {materials.map((material) => (
            <li key={material.id} id={`material-${material.id}`} className="scroll-mt-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{material.originalFileName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {material.extension.toUpperCase()} · {formatBytes(material.fileSizeBytes)} · v
                    {material.version} · {material.parserName}
                    {material.pageCount ? ` · ${material.pageCount} 页` : ""}
                    {material.sheetNames.length
                      ? ` · 工作表：${material.sheetNames.join("、")}`
                      : ""}
                  </p>
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {statusLabels[material.parseStatus]}
                </span>
              </div>
              {material.parseMessage ? (
                <p className="mt-2 text-xs leading-5 text-amber-800">{material.parseMessage}</p>
              ) : null}
              {material.segments.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-primary">
                    查看 {material.segments.length} 个定位片段
                  </summary>
                  <ol className="mt-3 space-y-2">
                    {material.segments.map((segment) => (
                      <li
                        key={segment.segmentIndex}
                        id={`material-${material.id}-segment-${segment.segmentIndex}`}
                        className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-6"
                      >
                        <span className="mr-2 font-mono text-muted-foreground">
                          {segment.location} · 字符 {segment.startOffset}–{segment.endOffset}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{segment.text}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
