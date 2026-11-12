"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

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
  const [sourceMode, setSourceMode] = useState<"text" | "webpage" | "file">("text");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const clearUnsaved = useUnsavedChanges(isDirty);

  async function submitTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSaving(true);
    try {
      const isFileSource = !task && sourceMode === "file";
      const formData = new FormData();
      if (isFileSource && sourceFile) {
        formData.set("sourceFile", sourceFile);
        formData.set("name", name);
        formData.set("description", description);
        formData.set(
          "background",
          JSON.stringify({ projectType, projectStage, collaborationScope }),
        );
      }
      const response = await fetch(task ? `/api/tasks/${task.id}` : "/api/tasks", {
        method: task ? "PATCH" : "POST",
        headers: isFileSource ? undefined : { "Content-Type": "application/json" },
        body: isFileSource
          ? formData
          : JSON.stringify(
              !task && sourceMode === "webpage"
                ? {
                    sourceType: "webpage",
                    sourceUrl,
                    name,
                    description,
                    background: { projectType, projectStage, collaborationScope },
                  }
                : {
                    name,
                    description,
                    background: { projectType, projectStage, collaborationScope },
                    noticeText,
                  },
            ),
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
      clearUnsaved();
      setIsDirty(false);
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
    <form
      onSubmit={submitTask}
      onChangeCapture={() => setIsDirty(true)}
      className="max-w-4xl space-y-8"
    >
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
            {sourceMode === "webpage" && !task ? "公开网页来源" : "通知或要求原文"}
          </h2>
          {sourceMode === "text" || task ? (
            <span className="text-xs text-muted-foreground">
              {noticeText.length.toLocaleString()} / 200,000 字符
            </span>
          ) : null}
        </div>
        {!task ? (
          <div className="inline-flex border border-border" role="group" aria-label="要求来源方式">
            <button
              type="button"
              aria-pressed={sourceMode === "text"}
              onClick={() => setSourceMode("text")}
              className={`h-9 px-3 text-xs ${sourceMode === "text" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              粘贴文本
            </button>
            <button
              type="button"
              aria-pressed={sourceMode === "webpage"}
              onClick={() => setSourceMode("webpage")}
              className={`h-9 border-l border-border px-3 text-xs ${sourceMode === "webpage" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              公开网页
            </button>
            <button
              type="button"
              aria-pressed={sourceMode === "file"}
              onClick={() => setSourceMode("file")}
              className={`h-9 border-l border-border px-3 text-xs ${sourceMode === "file" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              上传文件
            </button>
          </div>
        ) : null}
        {sourceMode === "webpage" && !task ? (
          <div>
            <label className="block text-sm font-medium" htmlFor="source-url">
              网页 URL
            </label>
            <input
              id="source-url"
              type="url"
              required
              maxLength={2048}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.org/notice"
              className={fieldClassName}
            />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              仅读取可公开访问的网页正文；登录受限或无法读取时，可返回并粘贴文本。
            </p>
          </div>
        ) : sourceMode === "file" && !task ? (
          <div>
            <label className="block text-sm font-medium" htmlFor="source-file">
              要求文件
            </label>
            <input
              id="source-file"
              type="file"
              required
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
              className={fieldClassName}
            />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              支持 PDF、DOCX、TXT，最大 20 MiB。扫描 PDF 暂不做 OCR；无法提取时可返回粘贴文本。
            </p>
          </div>
        ) : (
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
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          创建任务后可上传 PDF、DOCX、TXT、XLSX、CSV、JPG 与 PNG 材料；JPG/PNG 会进行中文和英文
          OCR，扫描 PDF 暂不支持 OCR。
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
          disabled={
            isSaving ||
            (sourceMode === "text" || task
              ? noticeText.trim().length === 0
              : sourceMode === "webpage"
                ? sourceUrl.trim().length === 0
                : !sourceFile)
          }
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving
            ? "正在保存…"
            : task
              ? "保存修改"
              : sourceMode === "webpage"
                ? "读取网页并创建任务"
                : sourceMode === "file"
                  ? "解析文件并创建任务"
                  : "创建审查任务"}
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
