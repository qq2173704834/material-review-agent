"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import Link from "next/link";
import { EvidencePane } from "@/components/evidence-preview";
import { SourceEvidencePreview } from "@/components/source-evidence-preview";
import type { ReviewCheckEvidence, SourcePosition } from "@/domain/review";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  LoaderCircle,
  Plus,
  Route,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { PrepState, PrepTask, PrepStage, PrepAssessment } from "@/domain/preparation";
import type { StudentGoal } from "@/domain/student-goal";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { beijingDay } from "@/lib/portal-feed";
import { notifyScheduleChanged } from "@/components/schedule-refresh";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { BrowsePosition } from "@/components/browse-back";
import { countdownLabel, formatExamTime } from "@/lib/goal-schedule";
import { learningDays, learningSummary, prepProgress, comparableScores } from "@/lib/preparation";

export interface PrepResource {
  id: string;
  version: number;
  title: string;
  stage: string;
  subject: string;
  reason: string;
}
export interface PrepEvent {
  id: string;
  date: string;
  label: string;
  title: string;
  href: string;
}
export interface PrepMaterial {
  id: string;
  name: string;
  verdict: string;
  taskId: string;
  executionId: string;
  sourceVersion: number;
  source: SourcePosition;
  recommendation: string;
  references: ReviewCheckEvidence[];
  evidence: string;
  href: string;
}
const views = [
  ["overview", "备考概览"],
  ["roadmap", "备考路线"],
  ["plan", "AI学习计划"],
  ["materials", "材料自查"],
] as const;
const verdictLabels: Record<string, string> = {
  passed: "通过",
  failed: "未通过",
  needs_confirmation: "待确认",
  unable_to_check: "无法检查",
  not_applicable: "不适用",
  not_started: "尚未检查",
};
function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0, 10);
}

export function PreparationCenter({
  goal,
  goals,
  initialState,
  events,
  resources,
  materials,
  materialStatus,
  files,
  initialNow,
  initialView,
  initialStage,
  recordsOnly = false,
}: {
  recordsOnly?: boolean;
  goal: StudentGoal;
  goals: StudentGoal[];
  initialState: PrepState;
  events: PrepEvent[];
  resources: PrepResource[];
  materials: PrepMaterial[];
  materialStatus: string;
  files: { id: string; name: string; version: number; parseStatus: string; taskId: string }[];
  initialNow: number;
  initialView: string;
  initialStage: string;
}): ReactElement {
  const router = useRouter();
  const [state, setState] = useState(initialState),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [previousInitial, setPreviousInitial] = useState(initialState);
  if (previousInitial !== initialState) {
    setPreviousInitial(initialState);
    if (initialState.revision >= state.revision) setState(initialState);
  }
  const [view, setView] = useState(
    recordsOnly ? "records" : views.some(([id]) => id === initialView) ? initialView : "overview",
  );
  const [now, setNow] = useState(initialNow);
  const [stageId, setStageId] = useState(
      initialState.stages.find((stage) => stage.id === initialStage)?.id ??
        initialState.stages[0]?.id ??
        "",
    ),
    [editingTask, setEditingTask] = useState<PrepTask | null>(null),
    [editingStage, setEditingStage] = useState<PrepStage | null>(null),
    [editingAssessment, setEditingAssessment] = useState<PrepAssessment | null>(null);
  const [minutes, setMinutes] = useState(goal.minutesPerDay || 45),
    [draftItems, setDraftItems] = useState(initialState.drafts.at(-1)?.items ?? []),
    [selected, setSelected] = useState<number[]>([]),
    [replace, setReplace] = useState(false),
    [planPreference, setPlanPreference] = useState(""),
    [planDay, setPlanDay] = useState(""),
    [heatPeriod, setHeatPeriod] = useState(84);
  const [selectedMaterial, setSelectedMaterial] = useState(materials[0]?.id ?? ""),
    [selectedFile, setSelectedFile] = useState(""),
    [heatMetric, setHeatMetric] = useState("tasks"),
    [heatDay, setHeatDay] = useState(beijingDay(initialNow)),
    [assessmentId, setAssessmentId] = useState(""),
    [compareId, setCompareId] = useState("");
  useUnsavedChanges(!!editingTask || !!editingStage || !!editingAssessment);
  const controller = useRef<AbortController | null>(null),
    pending = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 2200);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const restore = (): void => {
      const next = new URL(location.href).searchParams.get("view") ?? "overview";
      setView(recordsOnly ? "records" : views.some(([id]) => id === next) ? next : "overview");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [recordsOnly]);
  function navigate(next: string): void {
    setView(next);
    const url = new URL(location.href);
    url.searchParams.set("view", next);
    window.history.pushState(null, "", url);
  }
  async function send(command: unknown): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/preparation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId: goal.id, expectedRevision: state.revision, command }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setState(body.state);
      notifyScheduleChanged();
      setMessage("已保存");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const today = beijingDay(now),
    progress = prepProgress(state.tasks),
    activeStage = state.stages.find((stage) => stage.id === stageId) ?? state.stages[0];
  const upcoming = events
    .filter((event) =>
      event.date.includes("T") ? Date.parse(event.date) >= now : event.date.slice(0, 10) >= today,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const draft = state.drafts.at(-1),
    days = learningDays(state.tasks);
  const thisWeek = learningSummary(state.tasks, shiftDay(today, -6), today),
    lastWeek = learningSummary(state.tasks, shiftDay(today, -13), shiftDay(today, -7));
  const assessments = [...state.assessments].sort((a, b) => a.date.localeCompare(b.date));
  const assessment = assessments.find((item) => item.id === assessmentId) ?? assessments.at(-1);
  const compared = assessments.find(
    (item) => item.id === compareId && assessment && comparableScores(item, assessment),
  );
  const material = materials.find((item) => item.id === selectedMaterial) ?? materials[0];
  const stageTasks = state.tasks.filter((task) => task.stageId === activeStage?.id);
  const officialExam = upcoming.find((event) => /笔试|考试|口试|面试/.test(event.label));
  const shownResources = resources
    .filter(
      (resource) =>
        resource.stage === "通用" ||
        resource.stage === activeStage?.name ||
        resource.stage ===
          (["基础", "强化", "冲刺"][
            state.stages.findIndex((stage) => stage.id === activeStage?.id)
          ] ?? goal.studyStage),
    )
    .slice(0, 4);
  function tasksList(tasks: PrepTask[]): ReactElement {
    return (
      <div className="prep-tasks">
        {tasks.length ? (
          tasks.map((task) => (
            <div key={task.id} className="prep-task-row">
              <label>
                <input
                  aria-label={`完成：${task.title}`}
                  disabled={busy}
                  type="checkbox"
                  checked={!!task.doneOn}
                  onChange={(event) =>
                    void send({
                      action: "task",
                      task: { ...task, doneOn: event.target.checked ? today : "" },
                    })
                  }
                />
                <span className={task.doneOn ? "line-through text-muted-foreground" : ""}>
                  {task.title}
                </span>
              </label>
              <span className="text-xs text-muted-foreground">
                {task.minutes}分钟{task.date ? ` · ${task.date}` : " · 未排期"}
                {task.locked ? " · 保留安排" : ""}
                {task.resourceId &&
                resources.some(
                  (resource) =>
                    resource.id === task.resourceId &&
                    task.resourceVersion &&
                    resource.version !== task.resourceVersion,
                )
                  ? " · 资料有更新，可查看新版"
                  : ""}
                {task.resourceId && !resources.some((resource) => resource.id === task.resourceId)
                  ? " · 关联资料已不可用，可编辑替换"
                  : ""}
              </span>
              <div className="flex flex-wrap gap-2">
                {task.resourceId && (
                  <Link
                    className="prep-link"
                    href={`/learn/${task.resourceId}?from=prep&goal=${goal.id}&stage=${task.stageId}`}
                  >
                    查看资料
                  </Link>
                )}
                <button
                  type="button"
                  className="prep-link"
                  onClick={() => {
                    setEditingTask(task);
                    navigate("roadmap");
                  }}
                >
                  编辑
                </button>
                <button
                  aria-label={`删除任务：${task.title}`}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`删除“${task.title}”及对应学习记录？`))
                      void send({ action: "removeTask", id: task.id });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="prep-muted">这里还没有任务，可以添加一个小目标。</p>
        )}
      </div>
    );
  }
  async function generate(form: HTMLFormElement): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    controller.current = new AbortController();
    const values = new FormData(form),
      dates = values.getAll("date").map(String);
    try {
      const response = await fetch("/api/preparation?generate=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.current.signal,
        body: JSON.stringify({
          goalId: goal.id,
          expectedRevision: state.revision,
          requestId: crypto.randomUUID(),
          minutes,
          dates,
          preference: String(values.get("preference") ?? ""),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const next = body.state as PrepState;
      setState(next);
      setDraftItems(next.drafts.at(-1)?.items ?? []);
      setSelected(next.drafts.at(-1)?.items.map((_, i) => i) ?? []);
      setMessage("计划草稿已生成，请核对后采用");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "AbortError"
          ? "生成已取消，已有计划保留。"
          : cause instanceof Error
            ? cause.message
            : "生成失败，请重试。",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="prep-center space-y-6">
      <BrowsePosition identity={goal.id} />
      <header className="page-heading">
        <p className="text-sm text-primary">MY PREPARATION</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold">{recordsOnly ? "学习记录" : "目标详情"}</h1>
          <Link className="button-secondary" href="/me">
            管理考试目标
          </Link>
        </div>
        <p className="mt-2">围绕你的目标，走好今天这一步。</p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{CATEGORY_LABELS[goal.category]}</h2>
        <span className="prep-badge">
          {goal.region} · {goal.edition}
        </span>
        <span className="text-sm">
          {goal.state === "active" ? "备考中" : goal.state === "paused" ? "已暂停" : "已归档"}
        </span>
        {goals.length > 1 && (
          <label className="ml-auto">
            切换目标{" "}
            <select
              aria-label="切换备考目标"
              value={goal.id}
              onChange={(event) => {
                if (
                  (editingTask || editingStage || editingAssessment) &&
                  !window.confirm("有尚未保存的编辑，切换目标将丢失这些内容，是否继续？")
                )
                  return;
                router.push(
                  recordsOnly
                    ? `/me/records?goal=${event.target.value}`
                    : `/me/preparation?goal=${event.target.value}&view=${view}`,
                );
              }}
            >
              {goals.map((item) => (
                <option key={item.id} value={item.id}>
                  {CATEGORY_LABELS[item.category]} · {item.edition}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!recordsOnly && (
        <nav className="page-tabs" aria-label="备考中心页面">
          {views.map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {!recordsOnly && (
        <Link className="text-sm text-primary underline" href={`/me/records?goal=${goal.id}`}>
          查看此目标的学习记录 →
        </Link>
      )}
      <div aria-live="polite" className="prep-feedback">
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle size={16} className="animate-spin" />
            处理中…
          </span>
        ) : message ? (
          <span className="text-primary inline-flex items-center gap-2">
            <Check size={16} />
            {message}
          </span>
        ) : null}
        {error && (
          <div role="alert" className="text-destructive">
            {error}
            <button
              type="button"
              className="ml-3 prep-link"
              onClick={async () => {
                try {
                  const response = await fetch(`/api/preparation?goal=${goal.id}`);
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  setState(result.state);
                  setError("");
                } catch {
                  setError("重新读取失败，请稍后重试。");
                }
              }}
            >
              重新读取计划
            </button>
          </div>
        )}
      </div>
      {view === "overview" && (
        <>
          <section className="prep-hero">
            <div>
              <span className="prep-badge">我的主要目标</span>
              <h2 className="my-3 text-2xl font-semibold">今天，也离目标近一点</h2>
              <p className="prep-muted">
                {goal.minutesPerDay ? `每天${goal.minutesPerDay}分钟` : "每日学习时长未设置"} ·{" "}
                {goal.studyStage}
              </p>
              <button
                className="button-primary mt-5"
                onClick={() => {
                  const next = state.tasks.find((task) => !task.doneOn);
                  if (next) setStageId(next.stageId);
                  navigate("roadmap");
                }}
              >
                {state.tasks.some((task) => !task.doneOn) ? "继续学习" : "制定学习路线"}{" "}
                <ArrowRight size={16} />
              </button>
            </div>
            <div
              className="prep-progress-visual"
              aria-label={`计划任务已完成${progress.completed}项，共${progress.total}项`}
            >
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="49" fill="none" stroke="#e8e2fa" strokeWidth="8" />
                <circle
                  cx="60"
                  cy="60"
                  r="49"
                  fill="none"
                  stroke="#6c55ce"
                  strokeWidth="8"
                  strokeLinecap="round"
                  pathLength="100"
                  strokeDasharray={`${progress.percent} 100`}
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <span>
                <strong>{progress.total ? `${progress.percent}%` : "待开始"}</strong>
                <small>计划任务进度</small>
              </span>
            </div>
            <div className="prep-countdown">
              <p>{upcoming[0]?.label ?? "考试时间"}</p>
              <strong>{upcoming[0] ? countdownLabel(upcoming[0].date, now) : "待公布"}</strong>
              {upcoming[0] && <p>{formatExamTime(upcoming[0].date)}</p>}
            </div>
          </section>
          <div className="prep-columns">
            <section className="surface">
              <div className="prep-panel-title">
                <h2>今天的小目标</h2>
                <span className="prep-badge">
                  {state.tasks.filter((task) => task.date === today && task.doneOn).length}/
                  {state.tasks.filter((task) => task.date === today).length}
                </span>
              </div>
              {tasksList(state.tasks.filter((task) => task.date === today))}
            </section>
            <section className="surface">
              <h2 className="font-semibold mb-4">接下来的安排</h2>
              {upcoming.slice(0, 3).map((event) => (
                <p className="my-3" key={event.id}>
                  <Link className="prep-link" href={`/me/schedule?goal=${goal.id}`}>
                    {event.label} · {event.date.slice(0, 10)}
                  </Link>
                </p>
              ))}
              {!upcoming.length && (
                <p className="prep-muted">
                  {goal.state === "active"
                    ? goal.edition === "待确认考期"
                      ? "尚未选择考期，请在我的日程中选择要参加的场次。"
                      : "暂无待办日期，可在我的日程中核对考期和公告。"
                    : "目标已暂停或归档，活动提醒已停止。"}
                </p>
              )}
              <Link className="button-secondary mt-4" href={`/me/schedule?goal=${goal.id}`}>
                <CalendarDays size={16} />
                查看相关日程
              </Link>
            </section>
            <section className="surface">
              <div className="prep-panel-title">
                <h2>我的备考路线</h2>
                <span>{progress.total ? `${progress.percent}%` : "尚未制定计划"}</span>
              </div>
              <progress aria-label="计划任务完成比例" max={100} value={progress.percent} />
              <p className="mt-3 prep-muted">
                已完成{progress.completed}/{progress.total}项任务
              </p>
              <button className="prep-link mt-4" onClick={() => navigate("roadmap")}>
                展开路线 →
              </button>
            </section>
            <section className="surface">
              <h2 className="font-semibold mb-3">材料准备</h2>
              <p>{materialStatus}</p>
              <button className="button-secondary mt-4" onClick={() => navigate("materials")}>
                <ClipboardCheck size={16} />
                查看自查结果
              </button>
            </section>
          </div>
        </>
      )}
      {view === "roadmap" && (
        <>
          <section className="surface">
            <div className="prep-panel-title">
              <h2>把一个目标，拆成每一步</h2>
              <span>{progress.total ? `${progress.percent}%` : "尚未制定计划"}</span>
            </div>
            <progress max={100} value={progress.percent} aria-label="路线完成进度" />
            <div className="prep-stage-list">
              {state.stages.map((stage) => (
                <button
                  key={stage.id}
                  aria-pressed={activeStage?.id === stage.id}
                  onClick={() => {
                    setStageId(stage.id);
                    const url = new URL(location.href);
                    url.searchParams.set("stage", stage.id);
                    window.history.replaceState(null, "", url);
                  }}
                >
                  <Route size={17} />
                  <strong>{stage.name}</strong>
                  <span>
                    {
                      prepProgress(state.tasks.filter((task) => task.stageId === stage.id))
                        .completed
                    }
                    /{state.tasks.filter((task) => task.stageId === stage.id).length}
                  </span>
                  <small>
                    {stage.start ||
                      `建议第${state.stages.indexOf(stage) * 2 + 1}—${state.stages.indexOf(stage) * 2 + 2}周`}
                    {stage.end ? `—${stage.end}` : ""}
                  </small>
                </button>
              ))}
            </div>
            <p className="prep-muted text-sm my-3">
              通用学习建议，可按自己的节奏编辑；阶段区间属于个人计划。
            </p>
            {!state.stages.length && (
              <button
                className="button-primary"
                disabled={busy}
                onClick={() => {
                  const end = officialExam?.date.slice(0, 10);
                  if (
                    end &&
                    Date.parse(end) - Date.parse(today) >= 2 * 86400000 &&
                    confirm(
                      `按${today}至${end}平均安排3个学习建议阶段？这只设置个人区间，不变更考试日期。`,
                    )
                  )
                    void send({ action: "template", start: today, end });
                  else if (!end || confirm("改为建立无日期的通用阶段？可自行编辑区间。"))
                    void send({ action: "template" });
                }}
              >
                <Plus size={16} />
                建立通用备考路线
              </button>
            )}
            {activeStage && (
              <>
                <h3 className="font-semibold mb-2">{activeStage.name}</h3>
                {tasksList(stageTasks)}
                <div className="flex flex-wrap gap-3 mt-3">
                  <button className="prep-link" onClick={() => setEditingStage(activeStage)}>
                    编辑阶段
                  </button>
                  <button
                    className="prep-link"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("删除该阶段？请先移走其中任务。"))
                        void send({ action: "removeStage", id: activeStage.id });
                    }}
                  >
                    删除阶段
                  </button>
                </div>
              </>
            )}
          </section>
          <div className="prep-columns">
            <section className="surface">
              <details open={!!editingTask}>
                <summary className="font-semibold">
                  {editingTask ? "编辑任务" : "＋ 添加学习任务"}
                </summary>
                <form
                  key={editingTask?.id ?? "new-task"}
                  className="prep-form mt-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget,
                      data = new FormData(form);
                    const task: PrepTask = {
                      id: editingTask?.id ?? crypto.randomUUID(),
                      stageId: String(data.get("stage")),
                      title: String(data.get("title")),
                      date: String(data.get("date")),
                      minutes: Number(data.get("minutes")),
                      actualMinutes: data.get("actual") === "" ? null : Number(data.get("actual")),
                      doneOn: String(data.get("doneOn")),
                      resourceId: String(data.get("resource")),
                      locked: data.has("locked"),
                    };
                    if (await send({ action: "task", task })) {
                      setEditingTask(null);
                      form.reset();
                    }
                  }}
                >
                  <label>
                    任务名称
                    <input
                      name="title"
                      required
                      maxLength={200}
                      defaultValue={editingTask?.title}
                    />
                  </label>
                  <label>
                    所属阶段
                    <select
                      name="stage"
                      required
                      defaultValue={editingTask?.stageId ?? activeStage?.id}
                    >
                      {state.stages.map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    安排日期（可留空）
                    <input name="date" type="date" defaultValue={editingTask?.date} />
                  </label>
                  <label>
                    预计分钟
                    <input
                      name="minutes"
                      type="number"
                      min={0}
                      max={720}
                      defaultValue={editingTask?.minutes ?? 15}
                    />
                  </label>
                  <label>
                    实际分钟（未记录可留空）
                    <input
                      name="actual"
                      type="number"
                      min={0}
                      max={1440}
                      defaultValue={editingTask?.actualMinutes ?? ""}
                    />
                  </label>
                  <label>
                    完成日期（未完成留空）
                    <input name="doneOn" type="date" defaultValue={editingTask?.doneOn} />
                  </label>
                  <label className="sm:col-span-2">
                    关联资料
                    <select name="resource" defaultValue={editingTask?.resourceId ?? ""}>
                      <option value="">不关联资料</option>
                      {resources.map((resource) => (
                        <option key={resource.id} value={resource.id}>
                          {resource.title}
                        </option>
                      ))}
                      {editingTask?.resourceId &&
                        !resources.some((resource) => resource.id === editingTask.resourceId) && (
                          <option value={editingTask.resourceId}>原资料已不可用，可替换</option>
                        )}
                    </select>
                  </label>
                  <label>
                    <input name="locked" type="checkbox" defaultChecked={editingTask?.locked} />{" "}
                    重排时保留此安排
                  </label>
                  <div className="flex gap-2">
                    <button className="button-primary" disabled={busy || !state.stages.length}>
                      保存任务
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setEditingTask(null)}
                    >
                      取消编辑
                    </button>
                  </div>
                </form>
              </details>
              <details className="mt-5" open={!!editingStage}>
                <summary>＋ 添加或编辑阶段</summary>
                <form
                  className="prep-form mt-3"
                  key={editingStage?.id ?? "stage"}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget,
                      data = new FormData(form);
                    if (
                      await send({
                        action: "stage",
                        stage: {
                          id: editingStage?.id ?? crypto.randomUUID(),
                          name: String(data.get("name")),
                          start: String(data.get("start")),
                          end: String(data.get("end")),
                        },
                        position: Number(data.get("position")),
                      })
                    ) {
                      setEditingStage(null);
                      form.reset();
                    }
                  }}
                >
                  <label>
                    阶段名称
                    <input name="name" required maxLength={80} defaultValue={editingStage?.name} />
                  </label>
                  <label>
                    顺序
                    <input
                      name="position"
                      type="number"
                      min={0}
                      max={20}
                      defaultValue={
                        editingStage
                          ? state.stages.findIndex((stage) => stage.id === editingStage.id)
                          : state.stages.length
                      }
                    />
                  </label>
                  <label>
                    个人阶段开始
                    <input type="date" name="start" defaultValue={editingStage?.start} />
                  </label>
                  <label>
                    个人阶段结束
                    <input type="date" name="end" defaultValue={editingStage?.end} />
                  </label>
                  <button disabled={busy} className="button-primary">
                    保存阶段
                  </button>
                  <button type="button" onClick={() => setEditingStage(null)}>
                    取消编辑
                  </button>
                </form>
              </details>
            </section>
            <section className="surface">
              <h3 className="font-semibold">这一阶段可以用</h3>
              {shownResources.map((resource) => (
                <article className="my-4" key={resource.id}>
                  <Link
                    className="prep-link font-medium"
                    href={`/learn/${resource.id}?from=prep&goal=${goal.id}&stage=${activeStage?.id ?? ""}`}
                  >
                    {resource.title}
                  </Link>
                  <p className="prep-muted text-sm">{resource.reason}</p>
                  <button
                    type="button"
                    className="button-secondary mt-2"
                    disabled={busy || !activeStage}
                    onClick={() => {
                      if (
                        state.tasks.some((task) => task.resourceId === resource.id && !task.doneOn)
                      ) {
                        setError("已在未完成任务中，可到路线中编辑。");
                        return;
                      }
                      setEditingTask({
                        id: crypto.randomUUID(),
                        title: `学习：${resource.title}`,
                        stageId: activeStage!.id,
                        date: today,
                        minutes: 15,
                        actualMinutes: null,
                        doneOn: "",
                        resourceId: resource.id,
                        locked: false,
                      });
                    }}
                  >
                    ＋ 加入任务
                  </button>
                </article>
              ))}
              {!shownResources.length && (
                <p className="prep-muted my-3">暂时没有匹配资料，可到学习页查找。</p>
              )}
              <Link className="prep-link" href={`/learn?goal=${goal.id}`}>
                浏览目标学习资料 →
              </Link>
              <button className="button-secondary mt-4" onClick={() => navigate("plan")}>
                <Sparkles size={16} />
                调整本周学习计划
              </button>
            </section>
          </div>
        </>
      )}
      {view === "plan" && (
        <div className="prep-columns">
          <section className="surface">
            <h2 className="font-semibold text-lg">为我的目标制定计划</h2>
            <p className="prep-muted text-sm mt-2">
              当前目标：{CATEGORY_LABELS[goal.category]} · {goal.studyStage}·{" "}
              {goal.subject || "科目未设置"} · {goal.foundation || "基础未设置"}。
            </p>
            <form
              className="space-y-4 mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void generate(event.currentTarget);
              }}
            >
              <label className="block">
                每天可学习分钟
                <input
                  aria-label="每天可学习分钟"
                  type="number"
                  min={5}
                  max={720}
                  value={minutes}
                  onChange={(event) => setMinutes(Number(event.target.value))}
                  required
                />
              </label>
              <fieldset>
                <legend>可学习日期</legend>
                <div className="flex flex-wrap gap-3 mt-2">
                  {Array.from({ length: 7 }, (_, i) => shiftDay(today, i)).map((date) => (
                    <label key={date}>
                      <input name="date" type="checkbox" value={date} defaultChecked />
                      {date.slice(5)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                希望重点练习什么？
                <textarea
                  name="preference"
                  value={planPreference}
                  onChange={(event) => setPlanPreference(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="例如：每天练习听力，周末复习错题"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="button-primary" disabled={busy}>
                  <Sparkles size={16} />
                  生成计划草稿
                </button>
                {busy && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => controller.current?.abort()}
                  >
                    取消生成
                  </button>
                )}
              </div>
            </form>
            <Link className="prep-link mt-4 inline-block" href="/learn#assistant-privacy">
              学习与AI偏好
            </Link>
            <details className="mt-5">
              <summary>计划版本与撤销</summary>
              {state.history.map((history) => (
                <div className="mt-3" key={history.id}>
                  <p className="text-sm">
                    {new Date(history.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                  </p>
                  <button
                    className="button-secondary mt-1"
                    disabled={busy || history.undone}
                    onClick={() => {
                      if (
                        confirm(
                          `撤销此次采用：当前${state.tasks.length}项任务将恢复为${history.tasks.length}项。之后修改过任务时将拒绝覆盖。确认撤销？`,
                        )
                      )
                        void send({ action: "undo", id: history.id });
                    }}
                  >
                    {history.undone ? "已撤销" : "预览并撤销"}
                  </button>
                  <p className="text-xs prep-muted">
                    撤销后恢复为{history.tasks.length}项任务；有后续修改时保留当前记录。
                  </p>
                </div>
              ))}
            </details>
          </section>
          <section className="surface">
            <h2 className="font-semibold text-lg">一周学习安排</h2>
            {draft ? (
              <>
                <span className="prep-badge my-3">
                  {draft.mode === "mock" ? "模拟计划草稿" : "AI学习建议"} ·{" "}
                  {draft.adopted ? "已采用" : "待核对"}
                </span>
                <p className="prep-muted text-sm">{draft.reason}</p>
                <ul className="my-3 text-sm space-y-1" aria-label="每日计划时长">
                  {draft.dates.map((date) => (
                    <li key={date}>
                      {date} ·{" "}
                      {draftItems
                        .filter((item) => item.date === date)
                        .reduce((sum, item) => sum + item.minutes, 0)}{" "}
                      / {draft.minutes}分钟
                    </li>
                  ))}
                </ul>
                <label className="block my-3">
                  查看计划日期{" "}
                  <select value={planDay} onChange={(event) => setPlanDay(event.target.value)}>
                    <option value="">全部日期</option>
                    {draft.dates.map((date) => (
                      <option key={date} value={date}>
                        {date}
                      </option>
                    ))}
                  </select>
                </label>
                {draftItems.map(
                  (item, index) =>
                    (!planDay || item.date === planDay) && (
                      <div className="prep-draft-task" key={`${draft.id}-${index}`}>
                        <label>
                          <input
                            aria-label={`采用任务${index + 1}`}
                            type="checkbox"
                            checked={selected.includes(index)}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, index]
                                  : selected.filter((value) => value !== index),
                              )
                            }
                          />
                          采用此项
                        </label>
                        <input
                          aria-label={`计划任务${index + 1}`}
                          value={item.title}
                          maxLength={200}
                          onChange={(event) =>
                            setDraftItems(
                              draftItems.map((task, i) =>
                                i === index ? { ...task, title: event.target.value } : task,
                              ),
                            )
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <input
                            aria-label={`任务日期${index + 1}`}
                            type="date"
                            value={item.date}
                            onChange={(event) =>
                              setDraftItems(
                                draftItems.map((task, i) =>
                                  i === index ? { ...task, date: event.target.value } : task,
                                ),
                              )
                            }
                          />
                          <label>
                            分钟
                            <input
                              aria-label={`任务分钟${index + 1}`}
                              className="!w-24"
                              type="number"
                              min={1}
                              max={720}
                              value={item.minutes}
                              onChange={(event) =>
                                setDraftItems(
                                  draftItems.map((task, i) =>
                                    i === index
                                      ? { ...task, minutes: Number(event.target.value) }
                                      : task,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ),
                )}
                {!draft.adopted && (
                  <>
                    <label className="block mt-4">
                      <input
                        type="checkbox"
                        checked={replace}
                        onChange={(event) => setReplace(event.target.checked)}
                      />
                      替换所选日期的未完成任务（保留已完成/锁定任务）
                    </label>
                    <p className="prep-muted my-3">
                      将采用{selected.length}项；
                      {replace ? "替换范围为所选任务日期" : "与现有任务合并，相同日期同名任务跳过"}
                      。请核对日期和时间。
                    </p>
                    {replace && (
                      <details className="my-3 text-sm">
                        <summary>查看将替换的安排</summary>
                        <ul>
                          {state.tasks
                            .filter(
                              (task) =>
                                !task.doneOn &&
                                !task.locked &&
                                selected.some((index) => draftItems[index]?.date === task.date),
                            )
                            .map((task) => (
                              <li key={task.id}>
                                {task.date} · {task.title}
                              </li>
                            ))}
                        </ul>
                        <p>已完成和保留的任务维持原样。</p>
                      </details>
                    )}
                    <button
                      className="button-secondary mr-2"
                      disabled={busy}
                      onClick={() =>
                        void send({ action: "draft", draft: { id: draft.id, items: draftItems } })
                      }
                    >
                      保存草稿调整
                    </button>
                    <button
                      className="button-primary"
                      disabled={busy || !selected.length}
                      onClick={async () => {
                        if (JSON.stringify(draftItems) !== JSON.stringify(draft.items)) {
                          setError("请先保存草稿调整，再采用。");
                          return;
                        }
                        if (
                          confirm(
                            `确认将${selected.length}项任务加入${CATEGORY_LABELS[goal.category]}的计划？`,
                          )
                        )
                          await send({ action: "adopt", draftId: draft.id, replace, selected });
                      }}
                    >
                      ＋ 加入我的计划
                    </button>
                  </>
                )}
              </>
            ) : (
              <p className="prep-muted mt-4">
                先生成草稿，核对后再加入个人计划；也可以在路线中手动添加任务。
              </p>
            )}
          </section>
        </div>
      )}
      {view === "materials" && (
        <>
          <h2 className="text-xl font-semibold">提交之前，先检查一遍</h2>
          <p className="prep-muted">帮助你检查考试材料的缺项、格式和信息一致性。</p>
          <div className="prep-columns">
            <section className="surface">
              <p className="mb-4">{materialStatus}</p>
              {files.length > 0 && (
                <details className="mb-4">
                  <summary>已提供材料 · {files.length}份</summary>
                  {files.map((file) => (
                    <div className="my-3 text-sm" key={file.id}>
                      <p>
                        {file.name} · 当前版本{file.version} ·{" "}
                        {file.parseStatus === "text_extracted"
                          ? "已读取"
                          : file.parseStatus === "partial"
                            ? "部分内容已读取"
                            : "需要补充可读内容"}
                      </p>
                      <button
                        className="button-secondary mt-2"
                        onClick={() => setSelectedFile(selectedFile === file.id ? "" : file.id)}
                      >
                        {selectedFile === file.id ? "收起材料" : "查看材料"}
                      </button>
                      {selectedFile === file.id && (
                        <EvidencePane
                          key={`${file.id}-${file.version}`}
                          taskId={file.taskId}
                          evidence={{
                            materialId: file.id,
                            materialVersion: file.version,
                            quotedText: "",
                            location: "当前文件文本",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </details>
              )}
              <h3 className="font-medium mb-2">要求与检查结果</h3>
              {materials.map((item) => (
                <button
                  key={item.id}
                  className="prep-material"
                  aria-pressed={material?.id === item.id}
                  onClick={() => setSelectedMaterial(item.id)}
                >
                  <span>
                    {item.name}
                    <small className="block prep-muted mt-1">
                      材料准备：
                      {item.verdict === "failed"
                        ? "需调整"
                        : item.references.length
                          ? "已提供"
                          : item.verdict === "not_started"
                            ? "待检查"
                            : "待核对"}
                    </small>
                  </span>
                  <span className="prep-badge">{verdictLabels[item.verdict] ?? item.verdict}</span>
                </button>
              ))}
              {!materials.length && (
                <p className="prep-muted">尚无已执行结果，请确认要求并准备材料。</p>
              )}
              <Link className="button-primary mt-4" href={`/me/goals/${goal.id}`}>
                准备材料与运行自查
              </Link>
            </section>
            <section className="surface" aria-live="polite">
              {material ? (
                <>
                  <h3 className="font-semibold">{material.name}</h3>
                  <span className="prep-badge my-3">
                    {verdictLabels[material.verdict] ?? material.verdict}
                  </span>
                  <blockquote className="prep-evidence whitespace-pre-wrap">
                    {material.evidence || "暂无可定位证据，请打开检查详情核对执行范围。"}
                  </blockquote>
                  {material.recommendation && (
                    <p className="my-3">下一步：{material.recommendation}</p>
                  )}
                  {material.executionId && (
                    <SourceEvidencePreview
                      taskId={material.taskId}
                      executionId={material.executionId}
                      source={material.source}
                      sourceVersion={material.sourceVersion}
                    />
                  )}
                  {material.references.map((evidence, index) => (
                    <EvidencePane
                      key={`${material.id}-${index}`}
                      taskId={material.taskId}
                      evidence={evidence}
                    />
                  ))}
                  <Link className="button-secondary mt-4" href={material.href}>
                    查看原文证据、整改与复检 →
                  </Link>
                </>
              ) : (
                <>
                  <ClipboardCheck className="text-primary" />
                  <h3 className="font-semibold mt-3">先确认适用的材料要求</h3>
                  <p className="prep-muted mt-2">
                    材料清单随考试公告确定，检查后会在这里显示问题和证据。
                  </p>
                </>
              )}
            </section>
          </div>
        </>
      )}
      {view === "records" && (
        <>
          <section className="surface">
            <div className="prep-panel-title">
              <h2>最近12周学习记录</h2>
              <label>
                记录范围{" "}
                <select
                  value={heatPeriod}
                  onChange={(event) => setHeatPeriod(Number(event.target.value))}
                >
                  <option value={84}>最近12周</option>
                  <option value={28}>最近4周</option>
                </select>
              </label>
              <label>
                显示指标
                <select value={heatMetric} onChange={(event) => setHeatMetric(event.target.value)}>
                  <option value="tasks">已完成任务数</option>
                  <option value="minutes">实际学习分钟</option>
                </select>
              </label>
            </div>
            <div className="prep-heatmap" aria-label="每日学习记录">
              {Array.from({ length: heatPeriod }, (_, index) =>
                shiftDay(today, index - heatPeriod + 1),
              ).map((date) => {
                const value = days[date]?.[heatMetric === "tasks" ? "tasks" : "minutes"] ?? 0;
                return (
                  <button
                    key={date}
                    aria-label={`${date}：${value}${heatMetric === "tasks" ? "项" : "分钟"}`}
                    aria-pressed={heatDay === date}
                    style={{
                      background: value
                        ? `color-mix(in srgb, var(--primary) ${Math.min(90, 25 + (value / (heatMetric === "tasks" ? 10 : 120)) * 65)}%, var(--card))`
                        : "var(--muted)",
                      color:
                        value / (heatMetric === "tasks" ? 10 : 120) > 0.6
                          ? "#fff"
                          : "var(--foreground)",
                    }}
                    onClick={() => setHeatDay(date)}
                  >
                    <span className="text-[10px]">{date.slice(5)}</span>
                  </button>
                );
              })}
            </div>
            <p className="prep-muted text-sm mt-3">
              浅色：无记录；颜色越深，记录越多。预计时长不计入实际学习。
            </p>
            <div className="mt-4" aria-live="polite">
              <strong>{heatDay}</strong>
              <p>
                已完成{days[heatDay]?.tasks ?? 0}项 ·{" "}
                {days[heatDay]?.recorded
                  ? `实际记录${days[heatDay]!.minutes}分钟`
                  : "实际时长未记录"}
              </p>
              {tasksList(state.tasks.filter((task) => task.doneOn === heatDay))}
            </div>
            <div className="mt-4 prep-muted">
              最近7天完成{thisWeek.tasks}项；前7天完成{lastWeek.tasks}项。实际时长：
              {thisWeek.minutes === null ? "未记录" : `${thisWeek.minutes}分钟`}（前7天：
              {lastWeek.minutes === null ? "未记录" : `${lastWeek.minutes}分钟`}）；记录天数
              {thisWeek.days}天。
            </div>
          </section>
          <div className="prep-columns">
            <section className="surface">
              <h2 className="font-semibold mb-3">我的自测记录</h2>
              <p className="prep-muted text-sm">记录自己的测试成绩，按同一评分体系查看变化。</p>
              <form
                className="prep-form mt-4"
                key={editingAssessment?.id ?? "assessment"}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget,
                    data = new FormData(form);
                  try {
                    const scores = String(data.get("scores"))
                      .split("\n")
                      .filter((line) => line.trim())
                      .map((line) => {
                        const [dimension, score, maximum] = line.split(/[,，]/);
                        return {
                          dimension: dimension?.trim() ?? "",
                          score: Number(score),
                          maximum: Number(maximum),
                        };
                      });
                    if (
                      await send({
                        action: "assessment",
                        assessment: {
                          id: editingAssessment?.id ?? crypto.randomUUID(),
                          name: String(data.get("name")),
                          date: String(data.get("date")),
                          source: String(data.get("source")),
                          system: String(data.get("system")),
                          scores,
                        },
                      })
                    ) {
                      setEditingAssessment(null);
                      form.reset();
                    }
                  } catch {
                    setError("请按“维度,得分,满分”填写。");
                  }
                }}
              >
                <label>
                  测评名称
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={editingAssessment?.name}
                  />
                </label>
                <label>
                  日期
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={editingAssessment?.date ?? today}
                  />
                </label>
                <label>
                  来源（用户自报）
                  <input
                    name="source"
                    required
                    maxLength={200}
                    defaultValue={editingAssessment?.source}
                  />
                </label>
                <label>
                  评分体系
                  <input
                    name="system"
                    required
                    maxLength={100}
                    placeholder="如：四级同一模拟卷体系"
                    defaultValue={editingAssessment?.system}
                  />
                </label>
                <label className="sm:col-span-2">
                  分项成绩：每行“维度,得分,满分”
                  <textarea
                    name="scores"
                    required
                    rows={4}
                    maxLength={3000}
                    placeholder={"阅读,70,100\n听力,60,100\n写作,65,100"}
                    defaultValue={editingAssessment?.scores
                      .map((score) => `${score.dimension},${score.score},${score.maximum}`)
                      .join("\n")}
                  />
                </label>
                <button disabled={busy} className="button-primary">
                  保存自测记录
                </button>
                <button type="button" onClick={() => setEditingAssessment(null)}>
                  取消编辑
                </button>
              </form>
              {assessments.map((item) => (
                <div className="prep-task-row" key={item.id}>
                  <span>
                    {item.date} · {item.name}（用户自报）
                  </span>
                  <button
                    className="prep-link"
                    onClick={() => {
                      setEditingAssessment(item);
                      setAssessmentId(item.id);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    disabled={busy}
                    aria-label={`删除测评：${item.name}`}
                    onClick={() => {
                      if (confirm("删除该自测记录？"))
                        void send({ action: "removeAssessment", id: item.id });
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </section>
            <section className="surface">
              <h2 className="font-semibold">能力分布与成绩变化</h2>
              {assessment ? (
                <>
                  <label className="block mt-3">
                    查看测评
                    <select
                      value={assessment.id}
                      onChange={(event) => {
                        setAssessmentId(event.target.value);
                        setCompareId("");
                      }}
                    >
                      {assessments.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.date} · {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block mt-3">
                    对照测评
                    <select
                      value={compared?.id ?? ""}
                      onChange={(event) => setCompareId(event.target.value)}
                    >
                      <option value="">不叠加对照</option>
                      {assessments
                        .filter(
                          (item) => item.id !== assessment.id && comparableScores(item, assessment),
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.date} · {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <AssessmentChart assessment={assessment} compared={compared} />
                  <p className="prep-muted text-sm">
                    {assessment.source} · {assessment.system} · 用户自报
                  </p>
                  {assessment.scores.map((score) => (
                    <div className="my-3" key={score.dimension}>
                      <div className="flex justify-between gap-2">
                        <span>{score.dimension}</span>
                        <span>
                          {score.score}/{score.maximum}
                          {compared
                            ? ` · 对照${compared.scores.find((item) => item.dimension === score.dimension)?.score}`
                            : ""}
                        </span>
                      </div>
                      <progress
                        aria-label={`${score.dimension}得分比例`}
                        max={score.maximum}
                        value={score.score}
                      />
                    </div>
                  ))}
                  <ScoreTrend
                    assessment={assessment}
                    assessments={assessments}
                    targetScore={goal.targetScore}
                  />
                  <button
                    className="button-secondary mt-3"
                    onClick={() => {
                      const weakest = [...assessment.scores].sort(
                        (a, b) => a.score / a.maximum - b.score / b.maximum,
                      )[0];
                      setPlanPreference(
                        `根据${assessment.name}（${assessment.date}，用户自报），希望重点练习${weakest?.dimension ?? "薄弱项"}。`,
                      );
                      navigate("plan");
                    }}
                  >
                    根据薄弱项调整计划
                  </button>
                </>
              ) : (
                <p className="prep-muted mt-4">
                  暂无自测记录。添加后查看分项表现，有两次可比记录后展示趋势。
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
function AssessmentChart({
  assessment,
  compared,
}: {
  assessment: PrepAssessment;
  compared: PrepAssessment | undefined;
}): ReactElement | null {
  if (assessment.scores.length < 3) return null;
  const count = assessment.scores.length;
  const point = (index: number, ratio: number): string => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return `${150 + Math.cos(angle) * 95 * ratio},${135 + Math.sin(angle) * 95 * ratio}`;
  };
  return (
    <svg
      viewBox="0 0 300 270"
      className="prep-radar"
      role="img"
      aria-label="自测分项得分占满分比例，精确值见下方列表"
    >
      <polygon
        points={assessment.scores.map((_, i) => point(i, 1)).join(" ")}
        fill="var(--muted)"
        stroke="var(--border)"
      />
      {assessment.scores.map((score, i) => (
        <line
          key={score.dimension}
          x1="150"
          y1="135"
          x2={point(i, 1).split(",")[0]}
          y2={point(i, 1).split(",")[1]}
          stroke="var(--border)"
        />
      ))}
      <polygon
        points={assessment.scores
          .map((score, i) => point(i, score.score / score.maximum))
          .join(" ")}
        fill="var(--primary)"
        fillOpacity=".2"
        stroke="var(--primary)"
      />
      {compared && (
        <polygon
          points={assessment.scores
            .map((score, i) => {
              const other = compared.scores.find((item) => item.dimension === score.dimension)!;
              return point(i, other.score / other.maximum);
            })
            .join(" ")}
          fill="none"
          stroke="var(--foreground)"
          strokeDasharray="4 4"
        />
      )}
      {assessment.scores.map((score, i) => {
        const [x, y] = point(i, 1.2).split(",");
        return (
          <text
            key={score.dimension}
            x={x}
            y={y}
            textAnchor="middle"
            fill="currentColor"
            fontSize="11"
          >
            {score.dimension.slice(0, 8)}
          </text>
        );
      })}
    </svg>
  );
}
function ScoreTrend({
  assessment,
  assessments,
  targetScore,
}: {
  assessment: PrepAssessment;
  assessments: PrepAssessment[];
  targetScore: string;
}): ReactElement {
  const comparable = assessments.filter((item) => comparableScores(item, assessment)),
    first = Date.parse(comparable[0]?.date ?? assessment.date),
    last = Date.parse(comparable.at(-1)?.date ?? assessment.date);
  if (comparable.length < 2)
    return <p className="prep-muted">同一评分体系还需至少两次记录才能展示趋势。</p>;
  const maximum = assessment.scores.reduce((sum, score) => sum + score.maximum, 0);
  const points = comparable.map((item) => ({
    item,
    x: last === first ? 30 : 30 + ((Date.parse(item.date) - first) / (last - first)) * 240,
    y: 140 - (item.scores.reduce((sum, score) => sum + score.score, 0) / maximum) * 110,
    total: item.scores.reduce((sum, score) => sum + score.score, 0),
  }));
  return (
    <div className="mt-4">
      <h3 className="font-medium">同体系总分趋势（满分{maximum}）</h3>
      <svg
        className="w-full"
        viewBox="0 0 300 175"
        role="img"
        aria-label="按实际测评日期排列的总分变化，下方列出每次分数"
      >
        <line x1="30" y1="140" x2="275" y2="140" stroke="var(--border)" />
        <text x="5" y="25" fill="currentColor" fontSize="11">
          {maximum}
        </text>
        <text x="10" y="140" fill="currentColor" fontSize="11">
          0
        </text>
        {/^\d+(\.\d+)?$/.test(targetScore) && Number(targetScore) <= maximum && (
          <g>
            <line
              x1="30"
              x2="275"
              y1={140 - (Number(targetScore) / maximum) * 110}
              y2={140 - (Number(targetScore) / maximum) * 110}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
            />
            <text
              x="35"
              y={135 - (Number(targetScore) / maximum) * 110}
              fontSize="10"
              fill="currentColor"
            >
              自定目标 {targetScore}
            </text>
          </g>
        )}
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
        />
        {points.map((point) => (
          <circle key={point.item.id} cx={point.x} cy={point.y} r="4" fill="var(--primary)">
            <title>
              {point.item.date}：{point.total}/{maximum}
            </title>
          </circle>
        ))}
        <text x="30" y="165" fill="currentColor" fontSize="11">
          {comparable[0]!.date}
        </text>
        <text x="270" y="165" textAnchor="end" fill="currentColor" fontSize="11">
          {comparable.at(-1)!.date}
        </text>
      </svg>
      {points.map((point) => (
        <p className="text-sm prep-muted" key={point.item.id}>
          {point.item.date} · {point.item.name}：{point.total}/{maximum} · {point.item.source}
        </p>
      ))}
    </div>
  );
}
