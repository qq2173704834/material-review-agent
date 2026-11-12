"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CollaborationScope, ReviewTaskDetails } from "@/domain/review";
import type { FormEvent, ReactElement } from "react";

interface TaskEditorProps {
  task?: ReviewTaskDetails;
}

export function TaskEditor({ task }: TaskEditorProps): ReactElement {
  const router = useRouter();
  const [name, setName] = useState(task?.name ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [projectType, setProjectType] = useState(task?.background.projectType ?? "");
  const [projectStage, setProjectStage] = useState(task?.background.projectStage ?? "");
  const [collaborationScope, setCollaborationScope] = useState<CollaborationScope>(
    task?.background.collaborationScope ?? "unknown",
  );
  const [noticeText, setNoticeText] = useState(task?.noticeSource.originalText ?? "");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submitTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch(task ? `/api/tasks/${task.id}` : "/api/tasks", {
        method: task ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          background: { projectType, projectStage, collaborationScope },
          noticeText,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("task" in result)) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "任务保存失败，请检查填写内容后重试。";
        setError(message);
        return;
      }
      const savedTask = result.task as ReviewTaskDetails;
      router.push(`/tasks/${savedTask.id}`);
      router.refresh();
    } catch {
      setError("暂时无法连接本地服务，请确认服务仍在运行后重试。");
    } finally {
      setIsSaving(false);
    }
  }

  const fieldClassName =
    "mt-2 min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <form onSubmit={submitTask} className="max-w-4xl space-y-8">
      <section
        className="space-y-5 border-y border-border py-6"
        aria-labelledby="task-info-heading"
      >
        <h2 id="task-info-heading" className="text-sm font-semibold">
          任务信息
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium">
            任务名称
            <input
              className={fieldClassName}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="留空时根据通知首行建议"
            />
          </label>
          <label className="text-sm font-medium">
            项目类型
            <input
              className={fieldClassName}
              value={projectType}
              maxLength={80}
              onChange={(event) => setProjectType(event.target.value)}
              placeholder="例如：科研项目、创业计划"
            />
          </label>
          <label className="text-sm font-medium">
            项目阶段
            <input
              className={fieldClassName}
              value={projectStage}
              maxLength={80}
              onChange={(event) => setProjectStage(event.target.value)}
              placeholder="例如：申报、结项"
            />
          </label>
          <label className="text-sm font-medium">
            参与范围
            <select
              className={fieldClassName}
              value={collaborationScope}
              onChange={(event) => setCollaborationScope(event.target.value as CollaborationScope)}
            >
              <option value="unknown">尚未确定</option>
              <option value="individual">个人项目</option>
              <option value="team">团队项目</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">
          任务说明
          <textarea
            className={`${fieldClassName} min-h-24 resize-y`}
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="可记录本次申报范围或内部备注"
          />
        </label>
      </section>
      <section className="space-y-3" aria-labelledby="notice-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="notice-heading" className="text-sm font-semibold">
            通知或要求原文
          </h2>
          <span className="text-xs text-muted-foreground">
            {noticeText.length.toLocaleString()} / 200,000 字符
          </span>
        </div>
        <textarea
          id="notice-text"
          aria-labelledby="notice-heading"
          className={`${fieldClassName} min-h-[320px] resize-y font-mono leading-7`}
          value={noticeText}
          maxLength={200000}
          required
          onChange={(event) => setNoticeText(event.target.value)}
          placeholder="粘贴本次通知、指南或项目要求。原文会按段落保存，并可查看字符位置与历史版本。"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          在此粘贴通知原文。创建任务后可上传 PDF、DOCX、TXT、XLSX、CSV、JPG 与 PNG
          材料；图片和扫描件尚未进行 OCR。
        </p>
      </section>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={isSaving || noticeText.trim().length === 0}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? "正在保存…" : task ? "保存修改" : "创建审查任务"}
        </button>
        {task ? (
          <span className="text-xs text-muted-foreground">
            修改通知会保存为新版本，历史原文会保留。
          </span>
        ) : null}
      </div>
    </form>
  );
}
