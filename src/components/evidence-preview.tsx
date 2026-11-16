"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { z } from "zod";
import type { ReviewCheckEvidence, MaterialVersionPreview } from "@/domain/review";
import type { ReactElement } from "react";

const previewSchema = z.object({
  preview: z.object({
    id: z.string(),
    version: z.number(),
    originalFileName: z.string(),
    extension: z.string(),
    parseStatus: z.enum(["text_extracted", "partial", "failed", "ocr_required"]),
    parseMessage: z.string(),
    pageCount: z.number().nullable(),
    totalSegments: z.number(),
    offset: z.number(),
    segments: z.array(
      z.object({
        segmentIndex: z.number(),
        text: z.string(),
        startOffset: z.number(),
        endOffset: z.number(),
        location: z.string(),
      }),
    ),
  }),
});

function Highlight({ text, quote }: { text: string; quote: string }): ReactElement {
  const index = quote ? text.indexOf(quote) : -1;
  return index < 0 ? (
    <>{text}</>
  ) : (
    <>
      {text.slice(0, index)}
      <mark className="bg-amber-200 text-black">{quote}</mark>
      {text.slice(index + quote.length)}
    </>
  );
}

export function EvidencePane({
  taskId,
  evidence,
}: {
  taskId: string;
  evidence: ReviewCheckEvidence;
}): ReactElement {
  const [offset, setOffset] = useState(evidence.segmentIndex ?? 0);
  const [preview, setPreview] = useState<MaterialVersionPreview | null>(null);
  const [error, setError] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const endpoint = `/api/tasks/${taskId}/materials/${evidence.materialId}/versions/${evidence.materialVersion}`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${endpoint}?offset=${offset}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("该材料版本当前不可读取；下方保留执行时保存的证据。");
        const parsed = previewSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("预览内容格式无法识别。");
        if (!controller.signal.aborted) {
          setPreview(parsed.data.preview);
          setError("");
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "读取失败，请重试。");
      });
    return () => controller.abort();
  }, [endpoint, offset]);
  const pageNumber = evidence.location.match(/第\s*(\d+)\s*页/)?.[1] ?? "1";
  return (
    <section className="min-w-0 rounded-lg border border-border p-3">
      <h4 className="break-words font-semibold">
        {preview?.originalFileName ?? "材料证据"} · v{evidence.materialVersion}
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">{evidence.location} · 执行时版本</p>
      <blockquote className="my-3 whitespace-pre-wrap break-words border-l-2 border-amber-400 pl-3 text-sm">
        {evidence.quotedText}
      </blockquote>
      {error ? (
        <p role="alert" className="text-sm text-amber-800">
          {error}
        </p>
      ) : !preview ? (
        <p role="status">正在读取对应版本…</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            解析文本预览，不代表原始排版。{preview.parseMessage}
          </p>
          <div className="my-3 flex flex-wrap gap-3">
            <a href={`${endpoint}?file=1`} target="_blank" rel="noreferrer" className="underline">
              打开原件 v{evidence.materialVersion}
            </a>
            {["pdf", "png", "jpg"].includes(preview.extension) ? (
              <button
                type="button"
                className="underline"
                onClick={() => setShowOriginal(!showOriginal)}
              >
                {showOriginal ? "收起原件" : "在此预览原件"}
              </button>
            ) : null}
          </div>
          {["mp4", "mov", "webm"].includes(preview.extension) ? (
            <video
              controls
              preload="metadata"
              className="my-3 max-w-full"
              src={`${endpoint}?file=1#t=${evidence.location.match(/视频\s*([\d.]+)\s*秒/)?.[1] ?? "0"}`}
            >
              <track kind="captions" />
            </video>
          ) : null}
          {showOriginal ? (
            preview.extension === "pdf" ? (
              <iframe
                title={`${preview.originalFileName} v${preview.version} 原件`}
                src={`${endpoint}?file=1#page=${pageNumber}`}
                className="h-96 w-full border border-border"
              />
            ) : (
              <Image
                unoptimized
                src={`${endpoint}?file=1`}
                alt={`${preview.originalFileName} v${preview.version} 原件`}
                width={1200}
                height={900}
                className="h-auto max-h-96 w-full object-contain"
              />
            )
          ) : null}
          {evidence.region ? (
            <div className="relative my-3 max-w-2xl">
              <Image
                unoptimized
                src={`/api/tasks/${taskId}/materials/${evidence.materialId}/image?version=${evidence.materialVersion}&page=${evidence.region.pageNumber}`}
                alt={`证据页图，第${evidence.region.pageNumber}页，红框为引用区域`}
                width={1200}
                height={1600}
                className="block h-auto w-full"
              />
              <div
                className="pointer-events-none absolute border-2 border-red-600 bg-red-500/10"
                style={{
                  left: `${evidence.region.box.x * 100}%`,
                  top: `${evidence.region.box.y * 100}%`,
                  width: `${evidence.region.box.width * 100}%`,
                  height: `${evidence.region.box.height * 100}%`,
                }}
              />
            </div>
          ) : null}
          <ol className="space-y-3">
            {preview.segments.map((segment) => (
              <li key={segment.segmentIndex} className="rounded bg-muted/40 p-2">
                <p className="text-xs text-muted-foreground">{segment.location}</p>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  <Highlight text={segment.text} quote={evidence.quotedText} />
                </p>
                {segment.endOffset - segment.startOffset > segment.text.length ? (
                  <p className="text-xs text-amber-800">
                    本片段超过 16,000 字符，展示开头；完整内容请打开原件。上方保留本次引用。
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {!preview.totalSegments ? (
            <p className="mt-2 text-sm">此版本没有可读取的文本片段。</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 5))}
              className="min-h-11 rounded border px-3 disabled:opacity-40"
            >
              上一组片段
            </button>
            <span>
              {preview.totalSegments ? offset + 1 : 0}–{Math.min(offset + 5, preview.totalSegments)}{" "}
              / {preview.totalSegments}
            </span>
            <button
              type="button"
              disabled={offset + 5 >= preview.totalSegments}
              onClick={() => setOffset(offset + 5)}
              className="min-h-11 rounded border px-3 disabled:opacity-40"
            >
              下一组片段
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function EvidencePreview({
  taskId,
  evidence,
  triggerLabel = "查看证据原文 / 对照",
  compact = false,
}: {
  taskId: string;
  evidence: ReviewCheckEvidence[];
  triggerLabel?: string;
  compact?: boolean;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState([0, 1]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={
          compact
            ? "min-h-11 text-xs text-primary underline underline-offset-4"
            : "mt-3 min-h-11 rounded-md border border-border px-3 text-xs text-primary"
        }
        onClick={() => {
          setIsOpen(true);
          dialog.current?.showModal();
        }}
      >
        {triggerLabel}
      </button>
      <dialog
        ref={dialog}
        onClose={() => {
          setIsOpen(false);
          trigger.current?.focus();
        }}
        className="fixed inset-0 m-auto max-h-[90vh] w-[96vw] max-w-6xl overflow-auto rounded-lg border border-border bg-background p-5 text-foreground backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-semibold">执行证据原文对照</h3>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="min-h-11 rounded border px-4"
          >
            关闭预览
          </button>
        </div>
        {isOpen ? (
          <div className={evidence.length > 1 ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
            {selected.slice(0, Math.min(2, evidence.length)).map((index, pane) => (
              <div key={pane} className="min-w-0">
                {evidence.length > 1 ? (
                  <select
                    aria-label={`对照材料 ${pane + 1}`}
                    value={index}
                    onChange={(event) =>
                      setSelected((current) =>
                        current.map((value, position) =>
                          position === pane ? Number(event.target.value) : value,
                        ),
                      )
                    }
                    className="mb-2 min-h-11 w-full rounded border bg-background px-2 text-sm"
                  >
                    {evidence.map((item, position) => (
                      <option key={position} value={position}>
                        证据 {position + 1} · v{item.materialVersion} · {item.location}
                      </option>
                    ))}
                  </select>
                ) : null}
                {evidence[index] ? (
                  <EvidencePane
                    key={`${index}-${evidence[index].materialId}-${evidence[index].materialVersion}`}
                    taskId={taskId}
                    evidence={evidence[index]}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
