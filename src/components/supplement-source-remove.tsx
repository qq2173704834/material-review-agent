"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ReactElement } from "react";

interface SupplementSourceRemoveProps {
  taskId: string;
  sourceId: string;
  displayName: string;
}

export function SupplementSourceRemove({
  taskId,
  sourceId,
  displayName,
}: SupplementSourceRemoveProps): ReactElement {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);

  async function removeSource(): Promise<void> {
    if (
      !window.confirm(
        `删除补充来源“${displayName}”？当前来源将被删除；已有执行中保存的证据快照继续保留，删除整个任务时一并清除。`,
      )
    )
      return;
    setError("");
    setIsRemoving(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/sources/${sourceId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("来源未能删除，请刷新后重试。");
        return;
      }
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请确认服务仍在运行后重试。");
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-red-700">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={`删除补充来源 ${displayName}`}
        title="删除补充来源"
        disabled={isRemoving}
        onClick={removeSource}
        className="inline-flex size-8 items-center justify-center border border-border hover:bg-muted disabled:opacity-50"
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </span>
  );
}
