"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, FileText, FolderOpen, Play, X } from "lucide-react";
import { nextTaskAction } from "@/lib/task-flow";
import { QuickGuide } from "@/components/quick-guide";
import type { TaskTool, TaskView } from "@/lib/task-flow";
import type { ReviewExecution, ReviewTaskDetails } from "@/domain/review";
import type { ReactElement, ReactNode, MouseEvent } from "react";

export interface StartOptions {
  forceFull?: boolean;
  skipClarification?: boolean;
  allowPartial?: boolean;
}
interface TaskWorkflow {
  view: TaskView;
  openTool: (tool: TaskTool, targetId?: string) => void;
  closeTool: () => void;
  navigate: (view: TaskView) => void;
  registerStart: (action: (options?: StartOptions) => Promise<void>) => () => void;
  registerSave: (action: () => Promise<void>) => () => void;
  savePreparation: () => Promise<void>;
  setActivity: (key: string, label: string | null) => void;
  hasActivity: () => boolean;
  setGate: (gate: "clarification" | "partial" | null) => void;
  reportExecution: (execution: ReviewExecution) => void;
  finish: (execution: ReviewExecution) => void;
  hasModelConfiguration: boolean;
  mode: "mock" | "live" | "invalid";
  registerCancel: (action: () => Promise<void>) => () => void;
  reportError: (message: string) => void;
  setPreparationProblems: (key: string, count: number) => void;
  hasPreparationProblems: () => boolean;
}
const WorkflowContext = createContext<TaskWorkflow | null>(null);
export function useTaskWorkflow(): TaskWorkflow | null {
  return useContext(WorkflowContext);
}

export function useTaskActivity(key: string, label: string | null): void {
  const setActivity = useTaskWorkflow()?.setActivity;
  useEffect(() => {
    setActivity?.(key, label);
    return () => setActivity?.(key, null);
  }, [key, label, setActivity]);
}

const toolTitles: Record<TaskTool, string> = {
  sources: "审查依据与任务背景",
  materials: "待审查材料",
  requirements: "查看 / 调整审查要求",
  clarification: "补充影响判定的信息",
  history: "来源历史与任务设置",
};

function ToolPane({
  name,
  activeTool,
  isVisible,
  close,
  children,
  error,
}: {
  name: TaskTool;
  activeTool: TaskTool | null;
  isVisible: boolean;
  close: () => void;
  children: ReactNode;
  error: string;
}): ReactElement {
  const element = useRef<HTMLElement>(null);
  const isModal = activeTool === name;
  useEffect(() => {
    if (!isModal) return;
    const panel = element.current;
    panel?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]',
        ),
      ).filter((item) => item.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) {
        event.preventDefault();
        panel.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [isModal, close]);
  return (
    <section
      ref={element}
      hidden={!isVisible && !isModal}
      inert={Boolean(activeTool && !isModal)}
      role={isModal ? "dialog" : "region"}
      aria-modal={isModal || undefined}
      aria-labelledby={`tool-${name}-heading`}
      tabIndex={-1}
      data-workflow-tool={name}
      className={
        isModal
          ? "fixed inset-x-3 top-[4vh] z-50 mx-auto max-h-[92vh] max-w-5xl overflow-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:inset-x-8 sm:p-7"
          : "min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6"
      }
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 id={`tool-${name}-heading`} className="text-base font-semibold">
          {toolTitles[name]}
        </h2>
        {isModal && (
          <button
            onClick={close}
            aria-label="关闭处理面板"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {isModal && error && (
        <p role="alert" className="mb-4 text-sm leading-6 text-red-800">
          {error}
        </p>
      )}
      {children}
    </section>
  );
}

export function TaskWorkspace({
  task,
  initialExecution,
  mode: configuredMode,
  hasModelConfiguration,
  sources,
  materials,
  requirements,
  clarification,
  review,
  history,
  controls,
}: {
  task: ReviewTaskDetails;
  initialExecution?: ReviewExecution;
  mode: "mock" | "live" | "invalid";
  hasModelConfiguration: boolean;
  sources: ReactNode;
  materials: ReactNode;
  requirements: ReactNode;
  clarification: ReactNode;
  review: ReactNode;
  history: ReactNode;
  controls: ReactNode;
}): ReactElement {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "mock" ? "mock" : configuredMode;
  const [reported, setReported] = useState<ReviewExecution | undefined>();
  const recordedExecution =
    reported &&
    (!initialExecution ||
      (reported.id !== initialExecution.id && reported.createdAt >= initialExecution.createdAt))
      ? reported
      : initialExecution;
  const execution =
    recordedExecution && recordedExecution.metadata?.mode !== mode
      ? { ...recordedExecution, validity: "needs_recheck" as const }
      : recordedExecution;
  const next = nextTaskAction(task, execution);
  const requestedView = searchParams.get("view");
  const view: TaskView = ["prepare", "review", "results"].includes(requestedView ?? "")
    ? (requestedView as TaskView)
    : execution
      ? execution.status === "running"
        ? "review"
        : "results"
      : "prepare";
  const [tool, setTool] = useState<TaskTool | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [gate, setGate] = useState<"clarification" | "partial" | null>(null);
  const [message, setMessage] = useState("");
  const [error, reportError] = useState("");
  const problems = useRef<Record<string, number>>({});
  const [problemCounts, setProblemCounts] = useState<Record<string, number>>({});
  const setPreparationProblems = useCallback((key: string, count: number) => {
    problems.current = { ...problems.current, [key]: count };
    setProblemCounts(problems.current);
  }, []);
  const hasPreparationProblems = useCallback(
    () => Object.values(problems.current).some((count) => count > 0),
    [],
  );
  const [activities, setActivities] = useState<Record<string, string>>({});
  const activityRef = useRef<Record<string, string>>({});
  const start = useRef<((options?: StartOptions) => Promise<void>) | null>(null);
  const save = useRef<(() => Promise<void>) | null>(null);
  const cancel = useRef<(() => Promise<void>) | null>(null);
  const registerCancel = useCallback((action: () => Promise<void>) => {
    cancel.current = action;
    return () => {
      if (cancel.current === action) cancel.current = null;
    };
  }, []);
  const closeTool = useCallback(() => {
    setTool(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  const scrollPositions = useRef<Partial<Record<TaskView, number>>>({});
  const previousView = useRef(view);
  useEffect(() => {
    function rememberScroll(): void {
      scrollPositions.current[previousView.current] = window.scrollY;
    }
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, []);
  useLayoutEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    const position = scrollPositions.current[view] ?? 0;
    window.scrollTo({ top: position, behavior: "instant" });
  }, [view]);
  const navigate = useCallback((target: TaskView) => {
    const params = new URLSearchParams(location.search);
    params.set("view", target);
    historyPush(params);
  }, []);
  const openTool = useCallback((target: TaskTool, targetId?: string) => {
    if (!document.activeElement?.closest('[role="dialog"]'))
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTool(target);
    if (targetId)
      requestAnimationFrame(() => {
        const node = document.getElementById(targetId);
        let ancestor = node;
        while (ancestor) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
        node?.scrollIntoView({ block: "center" });
      });
  }, []);
  const setActivity = useCallback((key: string, label: string | null) => {
    const updated = { ...activityRef.current };
    if (label) updated[key] = label;
    else delete updated[key];
    activityRef.current = updated;
    setActivities(updated);
  }, []);
  const registerStart = useCallback((action: (options?: StartOptions) => Promise<void>) => {
    start.current = action;
    return () => {
      if (start.current === action) start.current = null;
    };
  }, []);
  const registerSave = useCallback((action: () => Promise<void>) => {
    save.current = action;
    return () => {
      if (save.current === action) save.current = null;
    };
  }, []);
  const savePreparation = useCallback(async () => {
    await save.current?.();
  }, []);
  const hasActivity = useCallback(() => Object.keys(activityRef.current).length > 0, []);
  const finish = useCallback((finished: ReviewExecution) => {
    setReported(finished);
    setMessage(
      finished.status === "completed"
        ? "本次审查已完成，结果已保存。"
        : "本次检查已结束，未执行部分单独列出。",
    );
    if (new URLSearchParams(location.search).get("view") === "review") {
      const params = new URLSearchParams(location.search);
      params.set("view", "results");
      params.set("execution", finished.id);
      params.delete("rule");
      historyPush(params);
    }
  }, []);
  const context: TaskWorkflow = {
    view,
    openTool,
    closeTool,
    navigate,
    registerStart,
    registerSave,
    savePreparation,
    setActivity,
    hasActivity,
    setGate,
    reportExecution: setReported,
    finish,
    hasModelConfiguration,
    mode,
    registerCancel,
    reportError,
    setPreparationProblems,
    hasPreparationProblems,
  };
  const activity = Object.values(activities)[0];
  const cannotRun = mode === "invalid" || (mode === "live" && !hasModelConfiguration);
  const actionLabel =
    activity ??
    (gate === "clarification"
      ? "暂时跳过并开始审查"
      : gate === "partial"
        ? "基于可用材料继续"
        : error && next.kind === "start"
          ? "重试审查"
          : next.label);
  async function primaryAction(): Promise<void> {
    if (hasActivity()) return;
    reportError("");
    if (next.kind === "prepare") {
      navigate("prepare");
      openTool("sources", "notice-text");
      return;
    }
    if (next.kind === "results") {
      navigate(next.view);
      return;
    }
    await start.current?.({
      skipClarification: gate === "clarification",
      allowPartial: gate === "partial",
    });
  }
  // Existing evidence links also reveal their containing pane rather than scrolling into hidden content.
  function revealAnchor(event: MouseEvent<HTMLDivElement>): void {
    const anchor = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
    if (!anchor) return;
    const id = anchor.getAttribute("href")?.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    const pane = target?.closest<HTMLElement>("[data-workflow-tool]");
    if (pane) {
      event.preventDefault();
      openTool(pane.dataset.workflowTool as TaskTool, id);
    }
  }
  return (
    <WorkflowContext.Provider value={context}>
      <div onClickCapture={revealAnchor} className="space-y-6 pb-8">
        <div inert={Boolean(tool)}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Link
              className="min-h-11 py-3 text-sm text-muted-foreground hover:text-primary"
              href="/"
            >
              ← 返回任务列表
            </Link>
            <QuickGuide />
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium text-primary">
                  {execution?.validity === "needs_recheck"
                    ? "待复检 · 原结论保留"
                    : execution?.status === "running"
                      ? "正在审查"
                      : execution
                        ? "已有检查记录"
                        : "准备开始"}
                </p>
                <h1 className="break-words text-xl font-semibold sm:text-2xl">{task.name}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {
                    [task.noticeSource, ...task.supplementalSources].filter(
                      (source) => source.parseStatus === "text_extracted",
                    ).length
                  }{" "}
                  份可用审查依据 · {task.materials.length} 份材料
                </p>
              </div>
              <button
                data-testid="task-primary-action"
                disabled={Boolean(activity) || (next.kind === "start" && cannotRun)}
                onClick={() => void primaryAction()}
                className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {actionLabel}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              {mode === "mock"
                ? "模拟演示模式：不调用真实模型；规格工具读取实际材料，语义内容不会自动算作通过。"
                : mode === "live"
                  ? "真实模型模式：审查依据及检查所需材料片段将发送至已配置的模型服务。"
                  : "AI服务暂不可用，请稍后重试或联系管理员。"}
            </p>
            {cannotRun && (
              <p role="alert" className="mt-2 text-sm text-red-800">
                AI服务暂不可用，请稍后重试或联系管理员。输入和材料已保留。
              </p>
            )}
            {Object.values(problemCounts).some((count) => count > 0) && (
              <p className="mt-2 text-xs text-amber-900">
                上传队列有 {Object.values(problemCounts).reduce((sum, count) => sum + count, 0)}{" "}
                份文件待处理，成功文件已保留。
              </p>
            )}
            {mode !== "mock" && (
              <button
                className="mt-2 min-h-11 text-xs text-primary underline"
                disabled={Boolean(activity)}
                onClick={() => {
                  const params = new URLSearchParams(location.search);
                  params.set("mode", "mock");
                  historyPush(params);
                }}
              >
                明确使用模拟演示（不调用真实模型）
              </button>
            )}
            {activities.review && (
              <button
                className="ml-3 min-h-11 rounded-lg border px-4 text-xs"
                onClick={() => void cancel.current?.()}
              >
                取消审查
              </button>
            )}
            {!task.materials.length && (
              <p className="mt-2 text-xs text-amber-900">
                尚无材料：可先检查缺交项，内容核验会保留待确认或无法检查。
              </p>
            )}
            {gate && (
              <p role="status" className="mt-3 text-sm text-amber-900">
                {gate === "clarification"
                  ? "存在影响判定的背景或来源冲突。可以集中补充，也可跳过后先检查独立项。"
                  : "存在读取失败或部分读取的文件。继续仅基于可用内容，未读取范围不会算作通过。"}
                <button
                  className="ml-2 min-h-11 text-primary underline"
                  onClick={() =>
                    openTool(
                      gate === "clarification"
                        ? "clarification"
                        : problemCounts["upload-sources"]
                          ? "sources"
                          : "materials",
                    )
                  }
                >
                  {gate === "clarification" ? "补充信息 / 查看依据" : "处理材料问题"}
                </button>
              </p>
            )}
          </div>
          <div role="status" aria-live="polite" className="mt-3 text-sm text-primary">
            {message || activity || ""}
          </div>
          {!tool && error && (
            <p role="alert" className="my-3 text-sm leading-6 text-red-800">
              {error}
            </p>
          )}
          <nav
            aria-label="任务阶段"
            className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted p-1"
          >
            {(
              [
                ["prepare", "准备要求与材料", FolderOpen],
                ["review", "执行审查", Play],
                ["results", "处理问题与导出", FileText],
              ] as const
            ).map(([key, label, Icon], index) => (
              <button
                key={key}
                aria-current={view === key ? "step" : undefined}
                onClick={() => navigate(key)}
                className={`flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-xs sm:text-sm ${view === key ? "bg-card font-semibold text-primary shadow-sm" : "text-muted-foreground hover:bg-card/50"}`}
              >
                <Icon className="hidden size-4 sm:block" aria-hidden="true" />
                <span>
                  {index + 1}. {label}
                </span>
              </button>
            ))}
          </nav>
          {requestedView && !["prepare", "review", "results"].includes(requestedView) && (
            <p role="status" className="mt-2 text-xs">
              之前的阶段位置不可用，已回到当前可用视图。
            </p>
          )}
        </div>
        <div
          hidden={view !== "prepare"}
          inert={Boolean(tool)}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-muted-foreground">
            左侧提供通知或指南，右侧放需要审查的文件。准备好后点击上方主按钮。
          </p>
          <button
            onClick={() => openTool("requirements")}
            className="min-h-11 rounded-lg border bg-card px-4 text-sm text-primary"
          >
            查看 / 调整审查要求
          </button>
        </div>
        <div className={view === "prepare" ? "grid items-start gap-5 xl:grid-cols-2" : "contents"}>
          <ToolPane
            name="sources"
            activeTool={tool}
            isVisible={view === "prepare"}
            close={closeTool}
            error={error}
          >
            {sources}
          </ToolPane>
          <ToolPane
            name="materials"
            activeTool={tool}
            isVisible={view === "prepare"}
            close={closeTool}
            error={error}
          >
            {materials}
          </ToolPane>
          <ToolPane
            name="requirements"
            activeTool={tool}
            isVisible={false}
            close={closeTool}
            error={error}
          >
            {requirements}
          </ToolPane>
          <ToolPane
            name="clarification"
            activeTool={tool}
            isVisible={false}
            close={closeTool}
            error={error}
          >
            {clarification}
            <p className="mt-4 text-xs text-muted-foreground">
              无待补充项时可关闭；仍有未知条件时只影响相关检查。
            </p>
          </ToolPane>
          <ToolPane
            name="history"
            activeTool={tool}
            isVisible={false}
            close={closeTool}
            error={error}
          >
            {history}
            {controls}
          </ToolPane>
        </div>
        <div hidden={view === "prepare"} inert={Boolean(tool)} data-workflow-view="review-results">
          {review}
        </div>
        <div inert={Boolean(tool)} className="flex flex-wrap gap-3 border-t pt-4">
          <button
            className="min-h-11 px-2 text-xs text-primary underline"
            onClick={() => openTool("requirements")}
          >
            查看 / 调整审查要求
          </button>
          <button
            className="min-h-11 px-2 text-xs text-primary underline"
            onClick={() => openTool("history")}
          >
            来源历史与任务设置
          </button>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3" aria-hidden="true" />
            已保存内容保留在本地
          </span>
        </div>
        {tool && <div className="fixed inset-0 z-40 bg-slate-950/45" aria-hidden="true" />}
      </div>
    </WorkflowContext.Provider>
  );
}

function historyPush(params: URLSearchParams): void {
  window.history.pushState(null, "", `${location.pathname}?${params.toString()}`);
}
