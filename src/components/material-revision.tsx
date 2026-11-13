"use client";
import { useState } from "react";
import { useTaskActivity } from "@/components/task-workspace";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { ReactElement } from "react";
import type { ReviewMaterialSummary } from "@/domain/review";

export function MaterialRevisionEditor({
  taskId,
  material,
  onSaved,
}: {
  taskId: string;
  material: ReviewMaterialSummary;
  onSaved: (material: ReviewMaterialSummary) => void;
}): ReactElement {
  const [segmentIndex, setSegmentIndex] = useState(material.segments[0]?.segmentIndex ?? 0);
  const [text, setText] = useState(material.segments[0]?.text ?? "");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState(material.classification?.label ?? "");
  const [selectedVersion, setSelectedVersion] = useState(Math.max(1, material.version - 1));
  const [pageNumber, setPageNumber] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const originalText =
    material.segments.find((segment) => segment.segmentIndex === segmentIndex)?.text ?? "";
  useTaskActivity(
    `material-editor-${material.id}`,
    isSaving
      ? "正在保存材料修订"
      : isOpen &&
          (text !== originalText || !!note || label !== (material.classification?.label ?? ""))
        ? "请先保存或取消材料修订"
        : null,
  );
  const clearUnsaved = useUnsavedChanges(
    isOpen && (text !== originalText || !!note || label !== (material.classification?.label ?? "")),
  );
  async function save(
    action: "correction" | "restore" | "retry" | "classification" | "select_version",
  ): Promise<void> {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/materials/${material.id}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          version: material.version,
          selectedVersion,
          segmentIndex,
          text,
          note,
          pageNumber,
          label,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "保存失败，输入内容已保留。");
        return;
      }
      clearUnsaved();
      onSaved(payload.material);
    } catch {
      setMessage("连接失败，输入内容已保留，请重试。");
    } finally {
      setIsSaving(false);
    }
  }
  const buttonClass = "min-h-11 rounded-md border border-border px-3 text-xs disabled:opacity-50";
  return (
    <details className="mt-3" onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-primary">核对与修订解析文字</summary>
      {isOpen && (
        <div className="mt-3 space-y-3 rounded-md border border-border p-3">
          <p className="text-xs leading-5">
            修订形成新材料版本并使旧结果待复检。原件与历史文字保留；文字修正不自动证明未读页已经完整识别。
          </p>
          <a
            className="inline-flex min-h-11 items-center text-xs text-primary underline"
            href={`/api/tasks/${taskId}/materials/${material.id}/versions/${material.version}?file=1`}
            target="_blank"
            rel="noreferrer"
          >
            打开原件核对
          </a>
          {material.segments.length > 0 && (
            <>
              <label className="block text-xs">
                修订片段
                <select
                  aria-label="修订片段"
                  className="mt-1 block min-h-11 w-full rounded border p-2"
                  value={segmentIndex}
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    setSegmentIndex(index);
                    setText(
                      material.segments.find((segment) => segment.segmentIndex === index)?.text ??
                        "",
                    );
                  }}
                >
                  {material.segments.map((segment) => (
                    <option key={segment.segmentIndex} value={segment.segmentIndex}>
                      {segment.location}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs">
                核对后的文字
                <textarea
                  aria-label="核对后的文字"
                  className="mt-1 block min-h-32 w-full rounded border p-2"
                  maxLength={40_000}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <label className="block text-xs">
                修订依据
                <input
                  aria-label="修订依据"
                  className="mt-1 block min-h-11 w-full rounded border p-2"
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如：对照原件第 2 页纠正金额识别错误"
                />
              </label>
              <button
                className={buttonClass}
                disabled={isSaving || !note.trim() || !text.trim()}
                onClick={() => save("correction")}
              >
                保存文字修订
              </button>
            </>
          )}
          {material.revision && (
            <button className={buttonClass} disabled={isSaving} onClick={() => save("restore")}>
              恢复原始解析文字
            </button>
          )}
          <label className="block text-xs">
            材料类型（人工核对）
            <input
              aria-label="材料类型（人工核对）"
              className="mt-1 block min-h-11 w-full rounded border p-2"
              maxLength={80}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="例如申请书、技术文档；在修订依据中写明理由"
            />
          </label>
          <button
            className={buttonClass}
            disabled={isSaving || !label.trim() || !note.trim()}
            onClick={() => save("classification")}
          >
            保存材料类型
          </button>
          {material.version > 1 && (
            <div className="space-y-2">
              <label className="block text-xs">
                采用历史版本
                <input
                  aria-label="采用历史版本"
                  type="number"
                  min={1}
                  max={material.version - 1}
                  className="ml-2 min-h-11 w-20 rounded border p-2"
                  value={selectedVersion}
                  onChange={(event) => setSelectedVersion(Number(event.target.value))}
                />
              </label>
              <button
                className={buttonClass}
                disabled={isSaving || !note.trim()}
                onClick={() => save("select_version")}
              >
                采用此历史版本并生成新版本
              </button>
              <p className="text-xs">
                使用所选历史原件及解析，保留全部版本；请在修订依据说明本次采用原因。
              </p>
            </div>
          )}
          {material.extension === "pdf" && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs">
                重试页码
                <input
                  aria-label="重试页码"
                  type="number"
                  min={1}
                  max={Math.min(200, material.pageCount ?? 1)}
                  className="ml-2 min-h-11 w-20 rounded border p-2"
                  value={pageNumber}
                  onChange={(event) => setPageNumber(Number(event.target.value))}
                />
              </label>
              <button className={buttonClass} disabled={isSaving} onClick={() => save("retry")}>
                仅重试此页
              </button>
            </div>
          )}
          {isSaving && (
            <p role="status" className="text-xs">
              正在保存或识别，请稍候…
            </p>
          )}
          {message && (
            <p role="alert" className="text-xs text-amber-800">
              {message}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
