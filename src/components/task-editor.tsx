"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ExamSourcePicker } from "@/components/exam-source-picker";
import type { ExamImportPreview } from "@/domain/exam-import";
import { useTaskActivity, useTaskWorkflow } from "@/components/task-workspace";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

import type { CollaborationScope, ReviewTaskDetails } from "@/domain/review";
import type { FormEvent, ReactElement } from "react";

interface TaskEditorProps {
  task?: ReviewTaskDetails;
  initialSource?: { name: string; url: string };
}

export function TaskEditor({ task, initialSource }: TaskEditorProps): ReactElement {
  const router = useRouter();
  const workflow = useTaskWorkflow();
  const [name, setName] = useState(task?.name ?? initialSource?.name.slice(0, 100) ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [projectType, setProjectType] = useState(task?.background.projectType ?? "");
  const [projectStage, setProjectStage] = useState(task?.background.projectStage ?? "");
  const [collaborationScope, setCollaborationScope] = useState<CollaborationScope>(
    task?.background.collaborationScope ?? "unknown",
  );
  const [noticeText, setNoticeText] = useState(task?.noticeSource.originalText ?? "");
  const [sourceMode, setSourceMode] = useState<"text" | "webpage" | "file" | "exam">(
    initialSource ? "webpage" : "text",
  );
  const [sourceUrl, setSourceUrl] = useState(initialSource?.url ?? "");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [imported, setImported] = useState<ExamImportPreview | null>(null);
  const saving = useRef(false);
  const clearUnsaved = useUnsavedChanges(isDirty);

  useTaskActivity("task-save", isSaving ? "正在保存审查依据" : null);
  const [previousTask, setPreviousTask] = useState(task);
  if (task !== previousTask) {
    setPreviousTask(task);
    if (task && !isDirty) {
      setName(task.name);
      setDescription(task.description);
      setProjectType(task.background.projectType);
      setProjectStage(task.background.projectStage);
      setCollaborationScope(task.background.collaborationScope);
      setNoticeText(task.noticeSource.originalText);
    }
  }

  async function saveTask(forReview = false): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true;
    setError("");
    setIsSaving(true);
    try {
      const background = {
        conditionAnswers: task?.background.conditionAnswers,
        projectType,
        projectStage,
        collaborationScope,
      };
      const isFileSource = !task && sourceMode === "file";
      const formData = new FormData();
      if (isFileSource && sourceFile) {
        formData.set("sourceFile", sourceFile);
        formData.set("name", name);
        formData.set("description", description);
        formData.set("background", JSON.stringify(background));
      }
      const response = await fetch(
        task ? `/api/tasks/${task.id}` : sourceMode === "exam" ? "/api/exam-import" : "/api/tasks",
        {
          method: task ? "PATCH" : "POST",
          headers: isFileSource ? undefined : { "Content-Type": "application/json" },
          body: isFileSource
            ? formData
            : JSON.stringify(
                !task && sourceMode === "exam" && imported
                  ? {
                      selection: imported.selection,
                      noticeId: imported.id,
                      version: imported.version,
                      name,
                      description,
                      background,
                    }
                  : !task && sourceMode === "webpage"
                    ? {
                        sourceType: "webpage",
                        sourceUrl,
                        name,
                        description,
                        background,
                      }
                    : {
                        name,
                        description,
                        background,
                        noticeText,
                      },
              ),
        },
      );
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
        return false;
      }
      const savedTask = result.task as ReviewTaskDetails;
      clearUnsaved();
      setIsDirty(false);
      if (!forReview && !task) router.push(`/tasks/${savedTask.id}`);
      if (!forReview) router.refresh();
      return true;
    } catch {
      setError("暂时无法保存，请检查网络连接后重试。已填写的内容保留。");
      return false;
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  useEffect(() =>
    workflow?.registerSave(async () => {
      if (isDirty && !(await saveTask(true)))
        throw new Error("审查依据未能保存，请处理表单错误后重试。");
    }),
  );

  async function submitTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await saveTask();
  }

  const fieldClassName =
    "mt-2 min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <form
      onSubmit={submitTask}
      onChangeCapture={(event) => {
        if (event.target instanceof Element && !event.target.closest('[aria-label="选择我的考试"]'))
          setIsDirty(true);
      }}
      className={task ? "max-w-4xl space-y-4" : "max-w-4xl space-y-8"}
    >
      <section className="space-y-3" aria-labelledby="notice-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="notice-heading" className="text-sm font-semibold">
            {sourceMode === "webpage" && !task ? "公开网页来源" : "检查要求"}
          </h2>
          {sourceMode === "text" || task ? (
            <span className="text-xs text-muted-foreground">
              {task ? (isDirty ? "未保存" : "已保存") : ""}
            </span>
          ) : null}
        </div>
        {!task ? (
          <div className="source-tabs flex flex-wrap gap-1" role="group" aria-label="要求来源方式">
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
            <button
              type="button"
              disabled={isSaving}
              aria-pressed={sourceMode === "exam"}
              onClick={() => setShowImport(!showImport)}
              className={`h-9 border-l border-border px-3 text-xs ${sourceMode === "exam" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              从我的考试导入
            </button>
          </div>
        ) : null}
        {showImport && !task && (
          <ExamSourcePicker
            hasInput={!!(noticeText.trim() || sourceUrl || sourceFile || imported)}
            onCancel={() => setShowImport(false)}
            onSelect={(preview) => {
              setImported(preview);
              setSourceMode("exam");
              setShowImport(false);
              setIsDirty(true);
              if (!name.trim()) setName(preview.title.slice(0, 120));
            }}
          />
        )}
        {sourceMode === "exam" && imported && !task ? (
          <div className="source-preview">
            <p className="font-semibold">{imported.title}</p>
            <p className="text-sm text-muted-foreground">
              {imported.region} · {imported.edition} · {imported.scope}
            </p>
            <pre>{imported.text}</pre>
            {imported.warning && <p>{imported.warning}</p>}
          </div>
        ) : sourceMode === "webpage" && !task ? (
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
              请输入公开网页链接，也可以直接粘贴通知。
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
            <p className="mt-2 text-xs leading-5 text-muted-foreground">支持：PDF、DOCX、TXT</p>
          </div>
        ) : task ? (
          <details className="rounded-xl border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm text-primary">修改要求</summary>
            <textarea
              id="notice-text"
              aria-labelledby="notice-heading"
              className={`${fieldClassName} min-h-[180px] resize-y leading-7`}
              value={noticeText}
              maxLength={200000}
              required
              onChange={(event) => setNoticeText(event.target.value)}
            />
          </details>
        ) : (
          <textarea
            id="notice-text"
            aria-labelledby="notice-heading"
            className={`${fieldClassName} min-h-[180px] resize-y leading-7`}
            value={noticeText}
            maxLength={200000}
            required
            onChange={(event) => setNoticeText(event.target.value)}
            placeholder="粘贴考试通知或材料要求。"
          />
        )}
      </section>
      {task && (
        <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
          {task.noticeSource.originalText}
        </p>
      )}
      <details
        open={!task}
        className="space-y-5 border-y border-border py-4"
        aria-labelledby="task-info-heading"
      >
        <summary id="task-info-heading" className="cursor-pointer text-sm font-semibold">
          任务信息与条件背景
        </summary>
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
      </details>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div
        hidden={!!task && !isDirty}
        className="flex flex-wrap items-center gap-3 border-t border-border pt-5"
      >
        <button
          type="submit"
          disabled={
            isSaving ||
            (sourceMode === "text" || task
              ? noticeText.trim().length === 0
              : sourceMode === "webpage"
                ? sourceUrl.trim().length === 0
                : sourceMode === "exam"
                  ? !imported?.usable
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
                  ? "导入文件并创建任务"
                  : "创建审查任务"}
        </button>
        {task ? (
          <span className="text-xs text-muted-foreground">更新要求后，请重新检查材料。</span>
        ) : null}
      </div>
    </form>
  );
}
