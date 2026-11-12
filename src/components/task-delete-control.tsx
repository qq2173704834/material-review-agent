"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { ReactElement } from "react";

interface TaskDeleteControlProps {
  taskId: string;
  taskName: string;
}

export function TaskDeleteControl({ taskId, taskName }: TaskDeleteControlProps): ReactElement {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteTask(): Promise<void> {
    if (
      !window.confirm(
        `删除“${taskName}”？此操作会永久删除该任务的通知、规则、材料原件、检查记录和报告。`,
      )
    ) {
      return;
    }
    setError("");
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!response.ok) {
        const result: unknown = await response.json();
        setError(
          typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "任务删除失败。",
        );
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={isDeleting} onClick={deleteTask}>
        {isDeleting ? "正在删除…" : "删除任务"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-60 text-right text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
