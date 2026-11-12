"use client";

import { useRef, useState } from "react";
import { z } from "zod";
import type { ReactElement } from "react";
import type { SourcePosition } from "@/domain/review";

const sourceSchema = z.object({
  source: z.object({
    displayName: z.string(),
    sourceUrl: z.string().nullable(),
    version: z.number(),
    totalSegments: z.number(),
    segments: z.array(
      z.object({
        paragraphIndex: z.number(),
        text: z.string(),
        location: z.string().optional(),
        startOffset: z.number(),
        endOffset: z.number(),
      }),
    ),
  }),
});

export function SourceEvidencePreview({
  taskId,
  executionId,
  source,
  sourceVersion,
}: {
  taskId: string;
  executionId: string;
  source: SourcePosition;
  sourceVersion: number;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<z.infer<typeof sourceSchema>["source"] | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(source.paragraphIndex);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  async function load(position: number): Promise<void> {
    setIsLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        sourceId: source.sourceId,
        version: String(source.sourceVersion ?? sourceVersion),
        offset: String(position),
      });
      const response = await fetch(`/api/tasks/${taskId}/checks/${executionId}/source?${query}`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("此执行没有可读取的来源快照；已保存的原文引用仍显示在下方。");
      const parsed = sourceSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("来源快照格式无法识别。");
      setPreview(parsed.data.source);
      setOffset(position);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取失败，请重试。");
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="ml-2 min-h-11 text-primary underline"
        onClick={() => {
          setIsOpen(true);
          dialog.current?.showModal();
          void load(source.paragraphIndex);
        }}
      >
        查看执行时来源原文
      </button>
      <dialog
        ref={dialog}
        onClose={() => {
          setIsOpen(false);
          trigger.current?.focus();
        }}
        className="fixed inset-0 m-auto max-h-[90vh] w-[94vw] max-w-3xl overflow-auto rounded-lg border border-border bg-background p-5 text-foreground backdrop:bg-black/40"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">
            {preview?.displayName ?? source.displayName ?? "要求来源"} · v
            {source.sourceVersion ?? sourceVersion}
          </h3>
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            onClick={() => dialog.current?.close()}
          >
            关闭来源预览
          </button>
        </div>
        {isOpen ? (
          <blockquote className="my-4 whitespace-pre-wrap break-words border-l-2 border-amber-400 pl-3">
            {source.quotedText}
          </blockquote>
        ) : null}
        {isLoading ? <p role="status">正在读取来源…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {isOpen && preview && !error ? (
          <>
            {preview.sourceUrl ? (
              <a
                href={preview.sourceUrl}
                rel="noreferrer"
                target="_blank"
                className="break-all underline"
              >
                原网页地址（预览使用已保存正文）
              </a>
            ) : null}
            <ol className="my-3 space-y-3">
              {preview.segments.map((segment) => {
                const index = segment.text.indexOf(source.quotedText);
                return (
                  <li key={segment.paragraphIndex} className="rounded bg-muted/40 p-3">
                    <p className="text-xs">
                      {segment.location ?? `段落 ${segment.paragraphIndex + 1}`}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {index < 0 ? (
                        segment.text
                      ) : (
                        <>
                          {segment.text.slice(0, index)}
                          <mark>{source.quotedText}</mark>
                          {segment.text.slice(index + source.quotedText.length)}
                        </>
                      )}
                    </p>
                    {segment.endOffset - segment.startOffset > segment.text.length ? (
                      <p className="text-xs">本段展示前 16,000 字符；完整引用保留在上方。</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isLoading || offset === 0}
                className="min-h-11 rounded border px-3 disabled:opacity-40"
                onClick={() => void load(Math.max(0, offset - 5))}
              >
                前文
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 5, preview.totalSegments)} / {preview.totalSegments}
              </span>
              <button
                type="button"
                disabled={isLoading || offset + 5 >= preview.totalSegments}
                className="min-h-11 rounded border px-3 disabled:opacity-40"
                onClick={() => void load(offset + 5)}
              >
                后文
              </button>
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}
