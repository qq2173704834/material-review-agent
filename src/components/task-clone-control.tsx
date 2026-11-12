"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { ReactElement } from "react";

interface TaskCloneControlProps {
  taskId: string;
}

export function TaskCloneControl({ taskId }: TaskCloneControlProps): ReactElement {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isCloning, setIsCloning] = useState(false);

  async function cloneTask(): Promise<void> {
    setError("");
    setIsCloning(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/clone`, { method: "POST" });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("task" in result)) {
        setError(
          typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "任务复制失败。",
        );
        return;
      }
      const clonedTask = result.task as { id: string };
      router.push(`/tasks/${clonedTask.id}`);
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请稍后重试。");
    } finally {
      setIsCloning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={isCloning} onClick={cloneTask}>
        {isCloning ? "正在复制…" : "复制任务"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-60 text-right text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
