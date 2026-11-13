"use client";

import type { UploadEntry } from "@/lib/use-upload-queue";
import type { ReactElement } from "react";

export function UploadQueue({
  entries,
  retry,
  remove,
  cancel,
  isBusy,
}: {
  entries: UploadEntry[];
  retry: (id: string) => void;
  remove: (id: string) => void;
  cancel: () => void;
  isBusy: boolean;
}): ReactElement | null {
  if (!entries.length) return null;
  const labels = {
    waiting: "等待上传",
    reading: "上传并读取中",
    success: "读取成功",
    partial: "部分读取",
    failed: "上传或读取失败",
    cancelled: "已取消",
  };
  return (
    <div className="my-4">
      <p role="status" className="text-xs text-muted-foreground">
        本批成功 {entries.filter((entry) => entry.status === "success").length} · 待处理{" "}
        {entries.filter((entry) => entry.status !== "success").length}
      </p>
      {isBusy && (
        <button className="my-2 min-h-11 rounded border px-3 text-xs" onClick={cancel}>
          取消等待与当前上传
        </button>
      )}
      <ul aria-label="逐文件上传状态" className="mt-3 divide-y border-y">
        {entries.map((entry) => (
          <li key={entry.id} className="py-3 text-xs" data-upload-status={entry.status}>
            <p className="break-all font-medium">
              {entry.file.name} · {labels[entry.status]}
            </p>
            <p className="mt-1 break-words leading-6 text-muted-foreground">{entry.message}</p>
            {["failed", "partial", "cancelled"].includes(entry.status) && (
              <button
                className="mr-3 min-h-11 text-primary underline"
                onClick={() => retry(entry.id)}
              >
                重试此文件
              </button>
            )}
            {entry.status !== "reading" && entry.status !== "waiting" && (
              <button
                className="min-h-11 text-muted-foreground underline"
                onClick={() => remove(entry.id)}
              >
                移出队列
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
