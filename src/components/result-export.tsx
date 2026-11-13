"use client";

import { useState } from "react";
import type { ReactElement, MouseEvent } from "react";
import type { ReviewExecution } from "@/domain/review";

export function ReportDownload({
  href,
  label,
  fileName,
}: {
  href: string;
  label: string;
  fileName: string;
}): ReactElement {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  async function download(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
    event.preventDefault();
    if (isBusy) return;
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch(href);
      if (!response.ok) {
        setError("报告未能导出，当前检查记录与筛选已保留，请重试。");
        return;
      }
      saveBlob(await response.blob(), fileName);
    } catch {
      setError("本地服务暂时不可用，报告未导出，请重试。");
    } finally {
      setIsBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col">
      <a
        href={href}
        aria-disabled={isBusy}
        onClick={(event) => void download(event)}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        {isBusy ? "正在导出…" : label}
      </a>
      {error && (
        <span role="alert" className="max-w-sm text-xs text-red-800">
          {error}
        </span>
      )}
    </span>
  );
}

export function ExecutionPackage({
  taskId,
  execution,
  materials,
}: {
  taskId: string;
  execution: ReviewExecution;
  materials: Array<{ id: string; originalFileName: string }>;
}): ReactElement {
  const [choices, setChoices] = useState<Record<string, { include: boolean; name: string }>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const choiceFor = (id: string, index: number): { include: boolean; name: string } =>
    choices[id] ?? {
      include: true,
      name: `${String(index + 1).padStart(2, "0")}-${materials.find((item) => item.id === id)?.originalFileName ?? "材料"}`,
    };
  async function download(): Promise<void> {
    if (isBusy) return;
    setIsBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materials: execution.materialSnapshot.flatMap((item, index) => {
            const choice = choiceFor(item.materialId, index);
            return choice.include
              ? [{ id: item.materialId, version: item.version, name: choice.name }]
              : [];
          }),
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        setError(
          typeof payload === "object" &&
            payload &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : "材料副本包未能导出，请重试。",
        );
        return;
      }
      saveBlob(await response.blob(), "本次检查材料副本.zip");
    } catch {
      setError("本地服务暂时不可用，选择和输出名称已保留，请重试。");
    } finally {
      setIsBusy(false);
    }
  }
  return (
    <details className="my-4 rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium text-primary">
        打包本次检查的材料副本
      </summary>
      <p className="my-2 text-xs leading-6 text-muted-foreground">
        仅使用当前选定检查记录中的原件版本；不修改原件，不表示审查通过。旧版本原件不可用时明确提示失败。
      </p>
      <div className="space-y-3">
        {execution.materialSnapshot.map((item, index) => {
          const choice = choiceFor(item.materialId, index);
          const name =
            materials.find((candidate) => candidate.id === item.materialId)?.originalFileName ??
            "材料";
          return (
            <div className="grid gap-2 sm:grid-cols-[auto_1fr]" key={item.materialId}>
              <label className="flex min-h-11 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={choice.include}
                  onChange={(event) =>
                    setChoices((previous) => ({
                      ...previous,
                      [item.materialId]: { ...choice, include: event.target.checked },
                    }))
                  }
                />
                {name} · 检查时 v{item.version}
              </label>
              <label className="text-xs">
                副本输出名称
                <input
                  aria-label={`检查材料副本名称：${name}`}
                  className="mt-1 min-h-11 w-full min-w-0 rounded border px-3 text-sm"
                  maxLength={180}
                  value={choice.name}
                  onChange={(event) =>
                    setChoices((previous) => ({
                      ...previous,
                      [item.materialId]: { ...choice, name: event.target.value },
                    }))
                  }
                />
              </label>
            </div>
          );
        })}
      </div>
      <button
        disabled={isBusy || !execution.materialSnapshot.length}
        className="mt-4 min-h-11 rounded-lg border px-4 text-xs text-primary disabled:opacity-50"
        onClick={() => void download()}
      >
        {isBusy ? "正在打包…" : "导出本次检查材料副本包"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      )}
    </details>
  );
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
