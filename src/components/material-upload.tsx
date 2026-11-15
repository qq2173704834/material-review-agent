"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialRevisionEditor } from "./material-revision";
import { useUploadQueue } from "@/lib/use-upload-queue";
import { UploadQueue } from "@/components/upload-queue";
import type { ReviewMaterialSummary } from "@/domain/review";
import type { ReactElement } from "react";

const statusLabels = {
  text_extracted: "已读取",
  partial: "部分读取",
  failed: "读取失败",
  ocr_required: "需要文字识别",
} as const;
function formatBytes(fileSizeBytes: number): string {
  return fileSizeBytes < 1024 * 1024
    ? `${Math.max(1, Math.round(fileSizeBytes / 1024))} KiB`
    : `${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}
export function MaterialUpload({
  taskId,
  initialMaterials,
}: {
  taskId: string;
  initialMaterials: ReviewMaterialSummary[];
}): ReactElement {
  const router = useRouter();
  const queue = useUploadQueue(taskId, "materials");
  const [materials, setMaterials] = useState(initialMaterials);
  const [previousInitialMaterials, setPreviousInitialMaterials] = useState(initialMaterials);
  if (initialMaterials !== previousInitialMaterials) {
    setPreviousInitialMaterials(initialMaterials);
    setMaterials(initialMaterials);
  }
  return (
    <section aria-labelledby="materials-heading" className="min-w-0">
      <h3 id="materials-heading" className="text-sm font-semibold">
        上传待审查材料
      </h3>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        支持：PDF、DOCX、TXT、XLSX、CSV、JPG/JPEG、PNG、MD、JSON、YAML/YML、ZIP、MP4、WEBM、MOV
      </p>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          queue.enqueue(Array.from(event.dataTransfer.files));
        }}
        className="mt-4 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4"
      >
        <label htmlFor="material-files" className="block text-sm font-medium">
          选择或拖入文件，自动上传并读取
        </label>
        <input
          id="material-files"
          aria-label="选择审查材料"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.xlsx,.csv,.jpg,.jpeg,.png,.zip,.md,.json,.yaml,.yml,.mp4,.webm,.mov"
          onChange={(event) => {
            queue.enqueue(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
          className="mt-3 min-h-11 w-full min-w-0 text-xs file:mr-2 file:min-h-11 file:rounded-lg file:border file:bg-card file:px-3"
        />
      </div>
      <UploadQueue {...queue} />
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
                    {material.version}
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
              {material.classification ? (
                <p className="mt-2 text-xs">
                  材料类型：{material.classification.label} ·{" "}
                  {material.classification.method === "manual" ? "人工指定" : "内容线索，待核对"} ·{" "}
                  {material.classification.location}：{material.classification.quote}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  材料类型待确认，可展开文字核对后纠正。
                </p>
              )}
              {material.revision && (
                <p className="mt-2 text-xs text-muted-foreground">
                  解析修订：
                  {material.revision.kind === "correction"
                    ? "人工修订"
                    : material.revision.kind === "restore"
                      ? "恢复原始文字"
                      : material.revision.kind === "select_version"
                        ? "采用历史版本"
                        : material.revision.kind === "classification"
                          ? "人工分类"
                          : "单页重试"}{" "}
                  · 基于 v{material.revision.baseVersion} · {material.createdAt} ·{" "}
                  {material.revision.note}
                </p>
              )}
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer text-primary">读取与版本详细信息</summary>
                <p className="mt-2 break-all leading-6">
                  读取工具：{material.parserName} · 材料编号：{material.id} · 校验值：
                  {material.sha256}
                </p>
              </details>
              <MaterialRevisionEditor
                key={`${material.id}-${material.version}`}
                taskId={taskId}
                material={material}
                onSaved={(saved) => {
                  setMaterials((current) =>
                    current.map((item) => (item.id === saved.id ? saved : item)),
                  );
                  router.refresh();
                }}
              />
              {material.pageCoverage?.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-primary">逐页读取范围</summary>
                  <ul className="mt-2 space-y-2 text-xs leading-5">
                    {material.pageCoverage.map((page) => (
                      <li key={page.pageNumber}>
                        第 {page.pageNumber} 页 ·{" "}
                        {{ text: "文本层", ocr: "OCR", none: "未读取" }[page.method]}
                        {" · "}
                        {
                          {
                            read: "已读取",
                            partial: "部分读取",
                            failed: "失败",
                            skipped: "未处理",
                          }[page.status]
                        }
                        {page.confidence === undefined
                          ? ""
                          : ` · OCR 分数 ${Math.round(page.confidence)}`}
                        {" · "}
                        {page.message}
                      </li>
                    ))}
                  </ul>
                </details>
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
                        tabIndex={-1}
                        className="scroll-mt-6 rounded-md bg-muted/50 px-3 py-2 text-xs leading-6 target:bg-amber-100 target:ring-2 target:ring-amber-400"
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
