"use client";
import { ScheduleExamCard } from "@/components/schedule-exam-card";
import { BrowsePosition } from "@/components/browse-back";
import { notifyScheduleChanged } from "@/components/schedule-refresh";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import {
  campusScheduleNodes,
  sortSchedule,
  scheduleDate,
  scheduleOverdue,
  SCHEDULE_GROUPS,
  type ScheduleNode,
} from "@/lib/schedule";
import { CampusSchoolRequest } from "@/components/campus-school-request";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  GraduationCap,
  Plus,
  Bell,
  Check,
  Pencil,
  Trash2,
  Upload,
  LoaderCircle,
} from "lucide-react";
import type { ReactElement, FormEvent } from "react";
import {
  CAMPUS_KINDS,
  type CampusEvent,
  type CampusState,
  type CampusNotice,
} from "@/domain/campus";
import { CAMPUS_SCHOOLS } from "@/domain/campus-schools";
import {
  campusConflicts,
  campusReminderKey,
  campusReminders,
  type CampusDraft,
} from "@/lib/campus";
import { countdownLabel as examCountdownLabel } from "@/lib/goal-schedule";
function countdownLabel(value: string, now: number): string {
  return !value
    ? "时间待定"
    : examCountdownLabel(
        value.length > 10 && !/[Z+]/u.test(value) ? `${value}:00+08:00` : value,
        now,
      );
}

const fieldClass =
  "min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm hover:bg-muted disabled:opacity-50";
function blankEvent(): CampusEvent {
  return {
    id: crypto.randomUUID(),
    title: "",
    kind: "作业",
    course: "",
    semester: "",
    start: "",
    end: "",
    location: "",
    note: "",
    sourceUrl: "",
    sourceId: "",
    sourceDigest: "",
    resourceIds: [],
    done: false,
    reminderHours: 24,
  };
}

export function CampusHub({
  initialState,
  sourceNotices = [],
  initialNotices,
  initialNow,
  initialProposal = "",
  initialEditor,
  resources = [],
  examNodes = [],
  mode = "notices",
  initialNoticeId,
  initialGoal = "",
  initialGroup = "",
  initialPending = false,
  initialEditMissing = false,
}: {
  sourceNotices?: CampusNotice[];
  resources?: Array<{ id: string; title: string; subject: string }>;
  initialProposal?: string;
  initialEditor?: CampusEvent;
  initialNow: number;
  initialState: CampusState;
  initialNotices: CampusNotice[];
  examNodes?: ScheduleNode[];
  mode?: "notices" | "schedule";
  initialNoticeId?: string;
  initialGoal?: string;
  initialGroup?: string;
  initialPending?: boolean;
  initialEditMissing?: boolean;
}): ReactElement {
  const router = useRouter();
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [state, setState] = useState(initialState),
    [notices, setNotices] = useState(initialNotices);
  const [previousInitial, setPreviousInitial] = useState(initialState);
  if (previousInitial !== initialState) {
    setPreviousInitial(initialState);
    if (initialState.revision >= state.revision) {
      setState(initialState);
      setNotices(initialNotices);
    }
  }
  const tab = mode;
  const [preferences, setPreferences] = useState(state.preferences),
    [isSettingsOpen, setIsSettingsOpen] = useState(
      !state.preferences.schoolId && mode === "notices",
    );
  const [editor, setEditor] = useState<CampusEvent | null>(initialEditor || null),
    [isImportOpen, setIsImportOpen] = useState(!!initialProposal && !initialEditor);
  const [text, setText] = useState(initialProposal),
    [url, setUrl] = useState(""),
    [referenceDate, setReferenceDate] = useState("");
  const [drafts, setDrafts] = useState<
    Array<{ event: CampusEvent; selected: boolean; warning: string }>
  >([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (message !== "已保存") return;
    const timer = setTimeout(() => setMessage(""), 2500);
    return () => clearTimeout(timer);
  }, [message]);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [category, setCategory] = useState(""),
    [unread, setUnread] = useState(false),
    [favoritesOnly, setFavoritesOnly] = useState(false),
    [course, setCourse] = useState("");
  const [group, setGroup] = useState(
      SCHEDULE_GROUPS.some((item) => item === initialGroup) ? initialGroup : "",
    ),
    [showCompleted, setShowCompleted] = useState(false),
    [pendingOpen, setPendingOpen] = useState(initialPending);
  const [previousGroup, setPreviousGroup] = useState(initialGroup);
  if (previousGroup !== initialGroup) {
    setPreviousGroup(initialGroup);
    setGroup(SCHEDULE_GROUPS.some((item) => item === initialGroup) ? initialGroup : "");
  }
  const [day, setDay] = useState(new Date(initialNow + 8 * 3600000).toISOString().slice(0, 10));
  const [opened, setOpened] = useState<string | null>(initialNoticeId || null),
    [month, setMonth] = useState(
      new Date(initialNow).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 7),
    );
  const [view, setView] = useState<"list" | "month">("list");
  const clearDirty = useUnsavedChanges(
    !!editor || (isImportOpen && (!!text || drafts.length > 0)),
    true,
  );
  const contextKey = JSON.stringify([initialEditor?.id, initialProposal, initialNoticeId]);
  const [previousContext, setPreviousContext] = useState(contextKey);
  if (previousContext !== contextKey) {
    setPreviousContext(contextKey);
    setEditor(initialEditor || null);
    setText(initialProposal);
    setIsImportOpen(!!initialProposal && !initialEditor);
    setDrafts([]);
    if (initialNoticeId) setOpened(initialNoticeId);
  }
  async function mutate(
    command: Record<string, unknown>,
    expectedRevision = state.revision,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/campus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, expectedRevision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败。");
      setState(result.state);
      setNotices(result.notices);
      setMessage("已保存");
      notifyScheduleChanged();
      router.refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function preview(items: CampusDraft[], source?: CampusNotice): void {
    setDrafts(
      items.map((draft, index) => ({
        event: {
          ...blankEvent(),
          title: draft.title,
          course: draft.course || "",
          location: draft.location || "",
          kind: draft.kind,
          start: draft.start,
          end: draft.end,
          note: draft.quote,
          sourceId: source?.id || "",
          sourceUrl: source?.url || url,
          sourceDigest: source?.digest || "",
          sourceNodeKey: source ? `${draft.kind}:${index}` : undefined,
        },
        selected: true,
        warning: draft.warning,
      })),
    );
    setIsImportOpen(true);
  }
  async function importNotice(file?: File): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      if (file) {
        form.set("file", file);
        form.set("referenceDate", referenceDate);
      }
      const response = await fetch("/api/campus/import", {
        method: "POST",
        ...(file
          ? { body: form }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, url, referenceDate }),
            }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      preview(result.drafts);
      if (result.partial) setMessage("部分内容未能读取，请逐项核对。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取失败，输入已保留。");
    } finally {
      setBusy(false);
    }
  }
  async function startMaterialReview(notice: CampusNotice): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/campus/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notice.id, digest: notice.digest }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      router.push(
        `/tasks/${result.taskId}?returnTo=${encodeURIComponent(mode === "notices" ? `/campus?notice=${notice.id}` : "/me/schedule")}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法建立自查任务。");
    } finally {
      setBusy(false);
    }
  }
  const safeEvents = state.events.map((event) => {
    const source = [...sourceNotices, ...notices].find((notice) => notice.id === event.sourceId);
    return event.sourceId && (!source || source.withdrawn || source.digest !== event.sourceDigest)
      ? { ...event, start: "", end: "" }
      : event;
  });
  const conflicts = campusConflicts(safeEvents),
    reminders = campusReminders(safeEvents, now).filter(
      (event) => !state.reminderReads.includes(campusReminderKey(event)),
    );
  const school = CAMPUS_SCHOOLS.find((item) => item.id === state.preferences.schoolId);
  const nodes = sortSchedule([...campusScheduleNodes(safeEvents), ...examNodes])
    .filter((node) => !initialGoal || node.goalIds.includes(initialGoal))
    .filter((node) => !course || node.event?.course === course)
    .filter((node) => !group || node.group === group)
    .filter((node) => showCompleted || !node.done);
  const dated = nodes.filter((node) => scheduleDate(node.value));
  const pendingNodes = nodes.filter((node) => !scheduleDate(node.value));
  const renderNode = (node: ScheduleNode): ReactElement =>
    node.event ? renderEvent(node.event) : <ScheduleExamCard key={node.id} node={node} now={now} />;
  const renderEvent = (event: CampusEvent): ReactElement => (
    <article
      id={`event-${event.id}`}
      key={event.id}
      aria-label={event.title}
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-primary">
            {event.kind}
            {event.course ? ` · ${event.course}` : ""}
            {event.semester ? ` · ${event.semester}` : ""}
          </p>
          <h3
            className={`mt-2 break-words font-semibold ${event.done ? "text-muted-foreground line-through" : ""}`}
          >
            {event.title}
          </h3>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs">
          {event.done
            ? "已完成"
            : scheduleOverdue(event.kind === "考试" ? event.start : event.end || event.start, now)
              ? "已到期 · 待完成"
              : countdownLabel(event.kind === "考试" ? event.start : event.end || event.start, now)}
        </span>
      </div>
      {event.sourceId &&
        [...sourceNotices, ...notices].some(
          (notice) =>
            notice.id === event.sourceId &&
            (notice.withdrawn || notice.digest !== event.sourceDigest),
        ) && (
          <p className="mt-3 text-sm text-amber-700">
            来源通知有变化，请重新核对安排；原填写内容仍保留在编辑中。
          </p>
        )}
      {(event.start || event.end || event.location) && (
        <p className="mt-3 text-sm text-muted-foreground">
          {event.start.replace("T", " ") || (event.end ? "" : "时间待定")}
          {event.end
            ? `${event.kind === "考试" ? " — " : "截止："}${event.end.replace("T", " ")}`
            : ""}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      )}
      {conflicts.some((pair) => pair.includes(event.id)) && (
        <p className="mt-2 text-sm text-amber-700">与另一场考试时间重叠</p>
      )}
      {event.sourceId &&
        [...sourceNotices, ...notices].some(
          (notice) => notice.id === event.sourceId && notice.digest !== event.sourceDigest,
        ) && <p className="mt-2 text-sm text-amber-700">原通知有更新，请核对日程。</p>}
      {event.note && (
        <details className="mt-2 text-sm">
          <summary>备注与来源</summary>
          <p className="mt-2 whitespace-pre-wrap">{event.note}</p>
          {event.sourceUrl && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              查看原通知
            </a>
          )}
        </details>
      )}
      {event.resourceIds?.map((id) => (
        <Link
          key={id}
          href={`/learn/${id}?returnTo=${encodeURIComponent(`/me/schedule?edit=${event.id}`)}`}
          className="mt-2 block text-sm text-primary underline"
        >
          学习资料：{resources.find((resource) => resource.id === id)?.title || "查看关联资料"}
        </Link>
      ))}
      {event.sourceId &&
        [...sourceNotices, ...notices]
          .filter(
            (notice) =>
              notice.id === event.sourceId &&
              !notice.withdrawn &&
              /(?:提交|上传|报送|提供)[^。\n]{0,60}(?:申请表|证明|报告|附件|材料)/u.test(
                notice.text,
              ),
          )
          .map((notice) => (
            <button
              key={notice.id}
              className={`${buttonClass} mt-3`}
              disabled={busy}
              onClick={() => void startMaterialReview(notice)}
            >
              检查申请材料
            </button>
          ))}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          disabled={busy}
          className={buttonClass}
          onClick={() =>
            void mutate({
              action: "save",
              events: [
                {
                  ...(state.events.find((item) => item.id === event.id) || event),
                  done: !event.done,
                },
              ],
            })
          }
        >
          <Check className="size-4" />
          {event.done ? "恢复待办" : "完成"}
        </button>
        <button
          className={buttonClass}
          onClick={() => setEditor(state.events.find((item) => item.id === event.id) || event)}
        >
          <Pencil className="size-4" />
          编辑
        </button>
        <button
          disabled={busy}
          className={buttonClass}
          onClick={() => {
            if (window.confirm(`删除“${event.title}”？`))
              void mutate({ action: "delete", id: event.id });
          }}
        >
          <Trash2 className="size-4" />
          删除
        </button>
      </div>
    </article>
  );
  return (
    <section className="space-y-6" aria-label={mode === "notices" ? "校园通知" : "我的日程"}>
      <BrowsePosition identity={`campus-${mode}`} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-primary">CAMPUS & DEADLINES</p>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
            <GraduationCap className="size-7" />
            {mode === "schedule" ? "我的日程" : school?.name || "校园通知"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "schedule"
              ? "考试、报名与作业，按时间安排好每一件事。"
              : "关注本校发布的消息，把重要安排加入自己的日程。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === "schedule" ? (
            <>
              <button className={buttonClass} onClick={() => setEditor(blankEvent())}>
                <Plus className="size-4" />
                添加日程
              </button>
              <button className={buttonClass} onClick={() => setIsImportOpen(!isImportOpen)}>
                <Upload className="size-4" />
                导入通知
              </button>
            </>
          ) : (
            <>
              <button className={buttonClass} onClick={() => setIsSettingsOpen(!isSettingsOpen)}>
                我的学校
              </button>
              <Link href="/me/schedule" className={buttonClass}>
                查看我的日程 →
              </Link>
            </>
          )}
        </div>
      </div>
      {initialEditMissing && (
        <p role="status" className="rounded-xl bg-muted p-4 text-sm">
          这条安排已删除或不属于当前账号，可在下方查看自己的日程。
        </p>
      )}
      {initialGoal && (
        <p className="text-sm text-muted-foreground">
          正在查看此目标的相关安排。
          <Link className="ml-2 text-primary underline" href="/me/schedule">
            全部安排
          </Link>
        </p>
      )}
      <p role="status" className="text-sm text-primary">
        {busy && <LoaderCircle className="mr-2 inline size-4 animate-spin" />}
        {message}
      </p>
      {isSettingsOpen && (
        <form
          className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate({ action: "preferences", preferences }).then((ok) => {
              if (ok) setIsSettingsOpen(false);
            });
          }}
        >
          <label className="text-sm">
            搜索学校
            <input
              className={fieldClass}
              value={schoolQuery}
              onChange={(event) => setSchoolQuery(event.target.value)}
              placeholder="输入学校名称"
            />
          </label>
          <label className="text-sm">
            学校
            <select
              aria-label="学校"
              className={fieldClass}
              value={preferences.schoolId}
              onChange={(event) => setPreferences({ ...preferences, schoolId: event.target.value })}
            >
              <option value="">暂不选择，先管理日程</option>
              {CAMPUS_SCHOOLS.filter(
                (item) => item.name.includes(schoolQuery) || item.id === preferences.schoolId,
              ).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            学院 / 专业
            <input
              className={fieldClass}
              value={preferences.department}
              maxLength={100}
              onChange={(event) =>
                setPreferences({ ...preferences, department: event.target.value })
              }
            />
          </label>
          <label className="text-sm">
            年级 / 班级
            <input
              className={fieldClass}
              maxLength={50}
              value={preferences.grade}
              onChange={(event) => setPreferences({ ...preferences, grade: event.target.value })}
            />
          </label>
          <fieldset className="flex flex-wrap gap-3 sm:col-span-2">
            <legend className="mb-2 text-sm">关注内容（优先展示）</legend>
            {["教务考试", "奖助评优", "竞赛", "校园活动", "就业实习"].map((interest) => (
              <label key={interest} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preferences.interests.includes(interest)}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      interests: event.target.checked
                        ? [...preferences.interests, interest]
                        : preferences.interests.filter((item) => item !== interest),
                    })
                  }
                />
                {interest}
              </label>
            ))}
          </fieldset>
          <button disabled={busy} className={buttonClass}>
            保存学校
          </button>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {school
              ? school.id === "sspu"
                ? "当前提供官网、教务处和学生工作处的公开通知。"
                : "当前提供教务处的公开通知。"
              : "没有你的学校？可先导入收到的通知或添加个人日程。"}
          </p>
        </form>
      )}
      {mode === "notices" && (
        <CampusSchoolRequest
          onSelectSchool={async (schoolId) => {
            const nextPreferences = { ...state.preferences, schoolId };
            const ok = await mutate({ action: "preferences", preferences: nextPreferences });
            if (ok) {
              setPreferences(nextPreferences);
              setIsSettingsOpen(false);
            }
            return ok;
          }}
        />
      )}
      {isImportOpen && (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">我收到的通知</h2>
          <label className="block text-sm">
            通知文字
            <textarea
              rows={4}
              className={fieldClass}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={30000}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              公开原文链接（可选）
              <input
                type="url"
                className={fieldClass}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <label className="text-sm">
              原通知 / 消息日期（相对日期需要）
              <input
                type="date"
                className={fieldClass}
                value={referenceDate}
                onChange={(event) => setReferenceDate(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button disabled={busy} className={buttonClass} onClick={() => void importNotice()}>
              识别并预览
            </button>
            <label className={buttonClass}>
              上传通知
              <input
                type="file"
                className="max-w-52 text-xs"
                disabled={busy}
                accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importNotice(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">支持 PDF、DOCX、TXT、JPG、PNG</p>
          {drafts.map((draft, index) => (
            <div key={draft.event.id} className="space-y-3 rounded-xl bg-muted/40 p-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.selected}
                  onChange={(event) =>
                    setDrafts(
                      drafts.map((item, i) =>
                        i === index ? { ...item, selected: event.target.checked } : item,
                      ),
                    )
                  }
                />
                加入日程
              </label>
              <input
                aria-label={`事项${index + 1}标题`}
                className={fieldClass}
                value={draft.event.title}
                onChange={(event) =>
                  setDrafts(
                    drafts.map((item, i) =>
                      i === index
                        ? { ...item, event: { ...item.event, title: event.target.value } }
                        : item,
                    ),
                  )
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  开始
                  <input
                    className={fieldClass}
                    placeholder="2026-12-01 或 2026-12-01T09:00"
                    value={draft.event.start}
                    onChange={(event) =>
                      setDrafts(
                        drafts.map((item, i) =>
                          i === index
                            ? { ...item, event: { ...item.event, start: event.target.value } }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="text-sm">
                  结束 / 截止
                  <input
                    className={fieldClass}
                    placeholder="留空表示待定"
                    value={draft.event.end}
                    onChange={(event) =>
                      setDrafts(
                        drafts.map((item, i) =>
                          i === index
                            ? { ...item, event: { ...item.event, end: event.target.value } }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <p className="text-xs text-amber-700">{draft.warning}</p>
              <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
                {draft.event.note}
              </blockquote>
            </div>
          ))}
          {drafts.length > 0 && (
            <button
              disabled={busy || !drafts.some((draft) => draft.selected)}
              className={buttonClass}
              onClick={() =>
                void mutate({
                  action: "save",
                  events: drafts.filter((draft) => draft.selected).map((draft) => draft.event),
                }).then((ok) => {
                  if (ok) {
                    setDrafts([]);
                    setIsImportOpen(false);
                    setText("");
                    clearDirty();
                    if (mode === "notices") router.push("/me/schedule");
                  }
                })
              }
            >
              确认加入我的日程
            </button>
          )}
        </section>
      )}
      {editor && (
        <EventEditor
          key={editor.id}
          resources={resources}
          event={editor}
          revision={state.revision}
          latestEvent={state.events.find((event) => event.id === editor.id)}
          currentSource={[...sourceNotices, ...notices].find(
            (notice) => notice.id === editor.sourceId,
          )}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={async (event, baseRevision) => {
            if (await mutate({ action: "save", events: [event] }, baseRevision)) {
              clearDirty();
              setEditor(null);
            }
          }}
        />
      )}
      {mode === "schedule" && !initialGoal && reminders.length > 0 && (
        <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <h2 className="flex items-center gap-2 font-medium">
            <Bell className="size-4" />
            近期提醒
          </h2>
          {reminders.map((event) => (
            <div
              key={event.id}
              className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {event.title} · {countdownLabel(event.end || event.start, now)}
              </span>
              <button
                className="underline"
                disabled={busy}
                onClick={() =>
                  void mutate({ action: "reminder-read", key: campusReminderKey(event) })
                }
              >
                知道了
              </button>
            </div>
          ))}
        </aside>
      )}
      {tab === "notices" ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="通知分类"
              className={`${fieldClass} max-w-44`}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">全部通知</option>
              {[...new Set(notices.map((notice) => notice.category))].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <label className="text-sm">
              <input
                type="checkbox"
                checked={unread}
                onChange={(event) => setUnread(event.target.checked)}
              />{" "}
              只看未读
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(event) => setFavoritesOnly(event.target.checked)}
              />
              我的收藏
            </label>
          </div>
          {!notices.length && (
            <p className="rounded-2xl bg-muted p-6">
              {school
                ? "暂时没有新通知，可以查看学校原文或到我的日程导入收到的消息。"
                : "选择学校后查看本校通知，也可以先添加个人日程。"}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {notices
              .filter(
                (notice) =>
                  (!category || notice.category === category) &&
                  (!favoritesOnly || state.favorites.includes(notice.id)) &&
                  (!unread || state.reads[notice.id] !== notice.digest),
              )
              .toSorted((left, right) => {
                const rank = (notice: CampusNotice): number =>
                  Number(state.preferences.interests.includes(notice.category)) +
                  Number(
                    !!state.preferences.department &&
                      notice.text.includes(state.preferences.department),
                  ) +
                  Number(
                    !!state.preferences.grade && notice.text.includes(state.preferences.grade),
                  );
                return (
                  rank(right) - rank(left) || right.publishedAt.localeCompare(left.publishedAt)
                );
              })
              .map((notice) => (
                <article
                  id={`notice-${notice.id}`}
                  key={notice.id}
                  className="rounded-2xl border bg-card p-5"
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {notice.department} · {notice.publishedAt}
                    </span>
                    <span>{state.reads[notice.id] === notice.digest ? "已读" : "未读"}</span>
                  </div>
                  <h2 className="mt-3 font-semibold leading-7">{notice.title}</h2>
                  {notice.withdrawn && (
                    <p className="mt-2 text-sm text-amber-700">
                      该通知已撤回，请查看学校后续安排。
                    </p>
                  )}
                  {!!state.reads[notice.id] && state.reads[notice.id] !== notice.digest && (
                    <p className="mt-2 text-sm text-primary">通知内容已更新</p>
                  )}
                  {!!notice.relatedUrls?.length && (
                    <details className="mt-2 text-sm">
                      <summary>其他发布来源</summary>
                      {notice.relatedUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all underline"
                        >
                          {url}
                        </a>
                      ))}
                    </details>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className={buttonClass}
                      onClick={() => {
                        setOpened(opened === notice.id ? null : notice.id);
                        if (state.reads[notice.id] !== notice.digest)
                          void mutate({ action: "read", id: notice.id, digest: notice.digest });
                      }}
                    >
                      查看通知
                    </button>
                    {/(?:提交|上传|报送|提供)[^。\n]{0,60}(?:申请表|证明|报告|附件|材料)/u.test(
                      notice.text,
                    ) &&
                      !notice.withdrawn && (
                        <button
                          disabled={busy}
                          className={buttonClass}
                          onClick={() => void startMaterialReview(notice)}
                        >
                          检查申请材料
                        </button>
                      )}
                    <a href={notice.url} target="_blank" rel="noreferrer" className={buttonClass}>
                      原文
                    </a>
                    <button
                      disabled={busy}
                      className={buttonClass}
                      onClick={() =>
                        void mutate({
                          action: "favorite",
                          id: notice.id,
                          enabled: !state.favorites.includes(notice.id),
                        })
                      }
                    >
                      {state.favorites.includes(notice.id) ? "取消收藏" : "收藏"}
                    </button>
                    <button
                      disabled={notice.withdrawn}
                      className={buttonClass}
                      onClick={async () => {
                        const { campusImportPreview } = await import("@/lib/campus");
                        const items = campusImportPreview(notice.text, notice.publishedAt);
                        const dated = items.filter((item) => item.start || item.end);
                        preview(dated.length ? dated : items, notice);
                      }}
                    >
                      {state.events.some((event) => event.sourceId === notice.id)
                        ? "已加入 · 再选节点"
                        : "＋ 加入日程"}
                    </button>
                  </div>
                  {state.events.some((event) => event.sourceId === notice.id) && (
                    <Link href="/me/schedule" className="mt-3 block text-sm text-primary underline">
                      查看已加入的安排 →
                    </Link>
                  )}
                  {opened === notice.id && (
                    <p className="mt-4 max-h-96 overflow-auto text-sm leading-7 whitespace-pre-wrap">
                      {notice.text}
                    </p>
                  )}
                </article>
              ))}
          </div>
        </>
      ) : (
        <section className="space-y-4">
          <nav className="flex flex-wrap gap-2" aria-label="日程分类">
            {["", ...SCHEDULE_GROUPS].map((item) => (
              <button
                key={item}
                className={`rounded-full px-4 py-2 text-sm ${group === item ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-primary/10"}`}
                aria-pressed={group === item}
                onClick={() => {
                  setGroup(item);
                  const query = new URLSearchParams(location.search);
                  if (item) query.set("group", item);
                  else query.delete("group");
                  window.history.replaceState(null, "", `${location.pathname}?${query}`);
                }}
              >
                {item || "全部"}
              </button>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              课程
              <select
                aria-label="课程筛选"
                className={`${fieldClass} max-w-44`}
                value={course}
                onChange={(event) => setCourse(event.target.value)}
              >
                <option value="">全部课程</option>
                {[...new Set(state.events.map((event) => event.course).filter(Boolean))].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  ),
                )}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
              />
              显示已完成
            </label>
            <button
              className={buttonClass}
              onClick={() => setView(view === "list" ? "month" : "list")}
            >
              <CalendarDays className="size-4" />
              {view === "list" ? "切换日历" : "近期待办"}
            </button>
          </div>
          {view === "month" && (
            <div className="rounded-2xl border bg-card p-3 sm:p-5">
              <label className="text-sm">
                月份
                <input
                  type="month"
                  value={month}
                  onChange={(event) => {
                    if (event.target.value) {
                      setMonth(event.target.value);
                      setDay(`${event.target.value}-01`);
                    }
                  }}
                  className={`${fieldClass} mb-4 max-w-52`}
                />
              </label>
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                  <span key={day} className="text-center text-xs text-muted-foreground">
                    {day}
                  </span>
                ))}
                {Array.from(
                  { length: (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 },
                  (_, i) => (
                    <span key={`empty-${i}`} />
                  ),
                )}
                {Array.from(
                  {
                    length: new Date(
                      Number(month.slice(0, 4)),
                      Number(month.slice(5)),
                      0,
                    ).getDate(),
                  },
                  (_, i) => {
                    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
                    const items = dated.filter((node) => scheduleDate(node.value) === date);
                    return (
                      <button
                        key={date}
                        aria-label={`${date}，${items.length}项安排`}
                        aria-pressed={day === date}
                        onClick={() => setDay(date)}
                        className={`min-w-0 min-h-16 rounded-lg border p-1 text-center text-xs sm:min-h-24 ${day === date ? "border-primary bg-primary/10" : ""}`}
                      >
                        <span>{i + 1}</span>
                        {items.length > 0 && (
                          <span className="mt-2 block text-primary">
                            {items.length}项
                            <span className="hidden truncate sm:block">{items[0]!.title}</span>
                          </span>
                        )}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          )}
          <h2 className="font-semibold">{view === "month" ? `${day}的安排` : "近期待办"}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {(view === "month"
              ? dated.filter((node) => scheduleDate(node.value) === day)
              : dated
            ).map(renderNode)}
          </div>
          {!(view === "month" ? dated.filter((node) => scheduleDate(node.value) === day) : dated)
            .length && (
            <p className="rounded-2xl bg-muted p-6 text-sm">
              {view === "month"
                ? "这一天暂无安排。"
                : "暂无有明确日期的待办，可添加日程或查看下方待公布安排。"}
            </p>
          )}
          <details
            id="pending"
            className="rounded-2xl border bg-card p-5"
            open={pendingOpen}
            onToggle={(event) => setPendingOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer font-medium">
              待公布安排 · {pendingNodes.length}
            </summary>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">{pendingNodes.map(renderNode)}</div>
            {!pendingNodes.length && (
              <p className="mt-3 text-sm text-muted-foreground">暂无时间待定的安排。</p>
            )}
          </details>
          {!nodes.length && (
            <Link className="text-sm text-primary underline" href="/me">
              选择考试目标，或添加自己的课程与作业 →
            </Link>
          )}
        </section>
      )}
    </section>
  );
}
function EventEditor({
  revision,
  latestEvent,
  currentSource,
  resources,
  event,
  busy,
  onSave,
  onCancel,
}: {
  resources: Array<{ id: string; title: string; subject: string }>;
  event: CampusEvent;
  busy: boolean;
  onSave: (event: CampusEvent, revision: number) => Promise<void>;
  revision: number;
  latestEvent?: CampusEvent;
  onCancel: () => void;
  currentSource?: CampusNotice;
}): ReactElement {
  const [draft, setDraft] = useState(event);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [precision, setPrecision] = useState(
    draft.start.length > 10 || draft.end.length > 10 ? "time" : "date",
  );
  function field(
    key: "title" | "course" | "semester" | "location" | "note",
    label: string,
  ): ReactElement {
    return (
      <label className="text-sm">
        {label}
        <input
          className={fieldClass}
          required={key === "title"}
          maxLength={key === "note" ? 5000 : key === "title" ? 160 : key === "semester" ? 60 : 100}
          value={draft[key]}
          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        />
      </label>
    );
  }
  function submit(event: FormEvent): void {
    event.preventDefault();
    void onSave(draft, baseRevision);
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-2xl border border-primary/30 bg-card p-5 sm:grid-cols-2"
    >
      <h2 className="font-semibold sm:col-span-2">安排个人事项</h2>
      {baseRevision !== revision && (
        <div className="space-y-3 rounded-xl bg-muted p-4 text-sm sm:col-span-2">
          <p>日程已有更新，你的输入仍保留。请核对最新内容后继续。</p>
          <details>
            <summary>最新保存内容</summary>
            <p className="mt-2 whitespace-pre-wrap">
              {latestEvent
                ? `${latestEvent.title}；${latestEvent.start || "开始待定"}；${latestEvent.end || "截止待定"}；${latestEvent.note}`
                : "当前没有这条已保存事项；若已删除，请取消编辑。"}
            </p>
          </details>
          <button type="button" className="underline" onClick={() => setBaseRevision(revision)}>
            已核对，继续保存当前编辑
          </button>
        </div>
      )}
      {event.sourceId &&
        (!currentSource ||
          currentSource.withdrawn ||
          currentSource.digest !== event.sourceDigest) && (
          <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 sm:col-span-2">
            <p>来源通知有变化，原填写内容保留。请核对原文与时间后再确认。</p>
            {currentSource && !currentSource.withdrawn ? (
              <label className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={draft.sourceDigest === currentSource.digest}
                  onChange={(change) =>
                    setDraft({
                      ...draft,
                      sourceDigest: change.target.checked
                        ? currentSource.digest
                        : event.sourceDigest,
                    })
                  }
                />
                我已核对最新通知中的安排
              </label>
            ) : (
              <label className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={!draft.sourceId}
                  onChange={(change) =>
                    setDraft({
                      ...draft,
                      sourceId: change.target.checked ? "" : event.sourceId,
                      sourceDigest: change.target.checked ? "" : event.sourceDigest,
                    })
                  }
                />
                保留为我自行维护的安排
              </label>
            )}
            {event.sourceUrl && (
              <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                查看原通知
              </a>
            )}
          </div>
        )}
      {field("title", "事项名称")}
      <label className="text-sm">
        类型
        <select
          className={fieldClass}
          value={draft.kind}
          onChange={(event) =>
            setDraft({ ...draft, kind: event.target.value as CampusEvent["kind"] })
          }
        >
          {CAMPUS_KINDS.map((kind) => (
            <option key={kind}>{kind}</option>
          ))}
        </select>
      </label>
      {field("course", "课程（可选）")}
      {field("semester", "学期（可选）")}
      <label className="text-sm">
        时间精度
        <select
          className={fieldClass}
          value={precision}
          onChange={(event) => {
            setPrecision(event.target.value);
            setDraft({ ...draft, start: draft.start.slice(0, 10), end: draft.end.slice(0, 10) });
          }}
        >
          <option value="date">仅日期</option>
          <option value="time">具体时刻（北京时间）</option>
        </select>
      </label>
      <label className="text-sm">
        提前提醒
        <select
          className={fieldClass}
          value={draft.reminderHours}
          onChange={(event) =>
            setDraft({
              ...draft,
              reminderHours: Number(event.target.value) as CampusEvent["reminderHours"],
            })
          }
        >
          <option value={0}>不提醒</option>
          <option value={72}>3天</option>
          <option value={24}>1天</option>
          {precision === "time" && <option value={2}>2小时</option>}
        </select>
      </label>
      <label className="text-sm">
        {draft.kind === "考试" ? "开始" : "开始（可选）"}
        <input
          type={precision === "time" ? "datetime-local" : "date"}
          className={fieldClass}
          value={draft.start}
          onChange={(event) => setDraft({ ...draft, start: event.target.value })}
        />
      </label>
      <label className="text-sm">
        {draft.kind === "考试" ? "结束（可选）" : "截止"}
        <input
          type={precision === "time" ? "datetime-local" : "date"}
          className={fieldClass}
          value={draft.end}
          onChange={(event) => setDraft({ ...draft, end: event.target.value })}
        />
      </label>
      <label className="text-sm">
        关联学习资料
        <select
          className={fieldClass}
          value={draft.resourceIds?.[0] || ""}
          onChange={(event) =>
            setDraft({ ...draft, resourceIds: event.target.value ? [event.target.value] : [] })
          }
        >
          <option value="">暂不关联</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.subject} · {resource.title}
            </option>
          ))}
        </select>
      </label>
      {field("location", "地点（可选）")}
      {field("note", "备注（可选）")}
      <p className="text-xs text-muted-foreground sm:col-span-2">日期可以留空，保存为时间待定。</p>
      <div className="flex gap-3 sm:col-span-2">
        <button disabled={busy} className={buttonClass}>
          保存日程
        </button>
        <button type="button" disabled={busy} className={buttonClass} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
