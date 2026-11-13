"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTaskWorkflow } from "@/components/task-workspace";

export interface UploadEntry {
  id: string;
  file: File;
  status: "waiting" | "reading" | "success" | "partial" | "failed" | "cancelled";
  message: string;
}

/** A selected batch keeps its original limits; each request has its own recoverable outcome. */
export function useUploadQueue(
  taskId: string,
  kind: "materials" | "sources",
): {
  entries: UploadEntry[];
  enqueue: (files: File[]) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  cancel: () => void;
  isBusy: boolean;
} {
  const router = useRouter();
  const workflow = useTaskWorkflow();
  const setActivity = workflow?.setActivity;
  const setPreparationProblems = workflow?.setPreparationProblems;
  const queue = useRef<UploadEntry[]>([]);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const isMounted = useRef(true);
  const activityKey = `upload-${kind}`;
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      controller.current?.abort();
      setActivity?.(activityKey, null);
      setPreparationProblems?.(activityKey, 0);
    };
  }, [activityKey, setActivity, setPreparationProblems]);
  function publish(): void {
    if (isMounted.current) {
      setEntries([...queue.current]);
      setPreparationProblems?.(
        activityKey,
        queue.current.filter((item) => ["failed", "partial", "cancelled"].includes(item.status))
          .length,
      );
    }
  }
  function update(id: string, changes: Partial<UploadEntry>): void {
    queue.current = queue.current.map((entry) =>
      entry.id === id ? { ...entry, ...changes } : entry,
    );
    publish();
  }
  async function drain(): Promise<void> {
    if (running.current) return;
    running.current = true;
    setActivity?.(activityKey, "正在上传并读取文件");
    try {
      while (isMounted.current) {
        const entry = queue.current.find((item) => item.status === "waiting");
        if (!entry) break;
        update(entry.id, {
          status: "reading",
          message: "正在上传并读取，完成后会显示实际读取范围。",
        });
        const abort = new AbortController();
        controller.current = abort;
        try {
          const form = new FormData();
          form.set(kind === "materials" ? "files" : "sourceFile", entry.file);
          const response = await fetch(`/api/tasks/${taskId}/${kind}`, {
            method: "POST",
            body: form,
            signal: abort.signal,
          });
          const payload: unknown = await response.json();
          if (!response.ok) {
            const error =
              typeof payload === "object" &&
              payload &&
              "error" in payload &&
              typeof payload.error === "string"
                ? payload.error
                : "文件未能保存，请重试或重新选择。";
            update(entry.id, { status: "failed", message: error });
            continue;
          }
          const items: unknown[] =
            typeof payload === "object" && payload
              ? "materials" in payload && Array.isArray(payload.materials)
                ? payload.materials
                : "source" in payload
                  ? [payload.source]
                  : []
              : [];
          if (!items.length) {
            update(entry.id, {
              status: "failed",
              message: "服务返回的结果无法识别，请核对已保存文件后重试。",
            });
            continue;
          }
          const statuses = items.map((item) =>
            typeof item === "object" && item && "parseStatus" in item ? item.parseStatus : "failed",
          );
          const status = statuses.every((item) => item === "text_extracted")
            ? "success"
            : statuses.every((item) => item === "failed" || item === "ocr_required")
              ? "failed"
              : "partial";
          update(entry.id, {
            status,
            message:
              status === "success"
                ? "已保存，成功文件不会被其他失败项清空。"
                : "文件已保存但存在未读取内容，可重试或在材料详情纠正；继续审查会明确说明影响。",
          });
          router.refresh();
        } catch {
          update(entry.id, {
            status: abort.signal.aborted ? "cancelled" : "failed",
            message: abort.signal.aborted
              ? "已停止等待；请核对服务端是否已保存，重试不会重复创建相同材料版本。"
              : "本地服务暂时不可用，文件仍保留，可重试。",
          });
          router.refresh();
        } finally {
          controller.current = null;
        }
      }
    } finally {
      running.current = false;
      setActivity?.(activityKey, null);
      publish();
    }
  }
  function enqueue(files: File[]): void {
    if (!files.length) return;
    const batchError =
      files.length > 10
        ? "每批最多10个文件，请重新选择。"
        : files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024
          ? "每批文件总大小不能超过50 MiB。"
          : "";
    for (const file of files) {
      const error =
        batchError ||
        (file.size === 0
          ? "文件为空，请重新选择。"
          : file.size > 20 * 1024 * 1024
            ? "单文件不能超过20 MiB。"
            : "");
      queue.current.push({
        id: crypto.randomUUID(),
        file,
        status: error ? "failed" : "waiting",
        message: error || "等待上传",
      });
    }
    publish();
    void drain();
  }
  function retry(id: string): void {
    update(id, { status: "waiting", message: "等待重试" });
    void drain();
  }
  function remove(id: string): void {
    queue.current = queue.current.filter((item) => item.id !== id || item.status === "reading");
    publish();
  }
  function cancel(): void {
    queue.current = queue.current.map((item) =>
      item.status === "waiting"
        ? { ...item, status: "cancelled", message: "已取消等待，文件保留，可重试或移出队列。" }
        : item,
    );
    controller.current?.abort();
    publish();
  }
  return {
    entries,
    enqueue,
    retry,
    remove,
    cancel,
    isBusy: entries.some((item) => item.status === "waiting" || item.status === "reading"),
  };
}
