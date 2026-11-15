import { savedLearningItems } from "@/lib/server/learning-store";
import { learningEntries } from "@/lib/server/learning-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { LearningActions } from "@/components/learning-actions";
import { ExamStatus, RegistrationDeadline } from "@/components/registration-deadline";
import { requestTime } from "@/lib/server/request-time";
import { examReminders } from "@/lib/server/exam-reminders";
import { ReminderRead } from "@/components/reminder-read";
import { StudentGoals } from "@/components/student-goals";
import { studentGoals } from "@/lib/server/student-goals";
import { listNotices } from "@/lib/server/exam-store";
import { resolvedGoalNotice } from "@/lib/goal-schedule";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import type { ReactElement } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { ExamActions, LinkVersionActions } from "@/components/exam-actions";
import { sessionAccount } from "@/lib/server/account-auth";
import { favorites, notice } from "@/lib/server/exam-store";
import { platformDb } from "@/lib/server/platform-db";
import { getReviewStore } from "@/lib/server/review-store";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement | null> {
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!account) redirect("/login?next=%2Fme");
  const now = await requestTime();
  const filters = await searchParams;
  const view = ["overview", "favorites", "feedback", "reviews"].includes(filters.view ?? "")
    ? filters.view
    : "overview";
  const goals = studentGoals(account.id);
  const feedback = platformDb()
    .prepare<[string], { id: string; kind: string; status: string; response: string }>(
      "SELECT id,kind,status,response FROM portal_feedback WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
    )
    .all(account.id);
  const resources = savedLearningItems(account.id);
  const jobs = platformDb()
    .prepare<
      [string],
      {
        id: string;
        goal_id: string;
        task_id: string;
        status: string;
        reason: string;
        created_at: string;
      }
    >(
      "SELECT id,goal_id,task_id,status,reason,created_at FROM portal_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
    )
    .all(account.id);
  const knowledge = learningEntries();
  const items = favorites(account.id).map((item) =>
    catalogLifecycle(knowledge, item.content.category, item.content.region).blocked &&
    item.content.disposition === "正常"
      ? { ...item, content: { ...item.content, disposition: "待核实" as const } }
      : item,
  );
  const store = getReviewStore();
  const links = platformDb()
    .prepare<
      [string],
      { notice_id: string; task_id: string; notice_version: number; stage: string; target: string }
    >("SELECT * FROM exam_task_links WHERE user_id=?")
    .all(account.id);
  const nodes = examReminders(account.id, now);
  return (
    <AppShell activePage="me">
      <div className="space-y-7">
        <header className="page-heading">
          <h1 className="text-3xl font-semibold">我的考试</h1>
          <p className="mt-3">这里汇总你的考试目标、学习进度、收藏与材料准备。</p>
        </header>
        <nav className="page-tabs" aria-label="个人内容导航">
          {[
            ["overview", "考试与日程"],
            ["favorites", `我的收藏 ${items.length + resources.length}`],
            ["feedback", "我的反馈"],
            ["reviews", "材料记录"],
          ].map(([key, label]) => (
            <Link
              key={key}
              href={`/me?view=${key}`}
              aria-current={view === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        {view === "overview" && (
          <>
            <StudentGoals
              goals={goals}
              notices={listNotices()}
              newCategory={filters.newCategory}
              noticeId={filters.noticeId}
            />
          </>
        )}
        {view === "feedback" && (
          <section className="surface space-y-3">
            <h2 className="font-semibold">我的内容反馈</h2>
            {feedback.length ? (
              feedback.map((item) => (
                <p key={item.id}>
                  {item.kind} · {item.status} · {item.response || "等待管理员核对"}
                </p>
              ))
            ) : (
              <p>暂无反馈。</p>
            )}
          </section>
        )}
        {view === "favorites" && (
          <section className="surface space-y-3">
            <h2 className="text-xl font-semibold">收藏的学习资料</h2>
            {resources.length ? (
              resources.map((item) => (
                <article key={item.id} className="rounded border p-3">
                  <Link href={`/learn/${item.id}`} className="underline">
                    {item.content.title}
                  </Link>
                  {item.status === "withdrawn" && (
                    <p className="text-sm text-muted-foreground">已撤回，请核对来源</p>
                  )}

                  <LearningActions id={item.id} saved seen={item.seen} />
                </article>
              ))
            ) : (
              <p>暂无学习资料收藏，可到学习页选择。</p>
            )}
          </section>
        )}
        {view === "overview" && (
          <section className="surface space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">考试日程</h2>
              <span className="text-xs text-muted-foreground">未来30天 · 北京时间</span>
            </div>

            {nodes.length ? (
              nodes.map((node, index) => (
                <p key={`${node.id}-${index}`}>
                  <Link className="text-primary underline" href={`/exams/${node.id}`}>
                    {node.title}
                  </Link>{" "}
                  · {node.label}：{node.value}
                  {Date.parse(node.value) < now ? "（已到日期，请核对时刻）" : ""}
                  {node.value.length === 10 ? "（仅日期）" : ""}
                  {node.read ? " · 提醒已读" : <ReminderRead id={node.id} version={node.version} />}
                </p>
              ))
            ) : (
              <p>
                {goals.some((goal) => goal.state === "active")
                  ? "未来30天暂无已公布的日期，可查看下方目标的全部安排。"
                  : "添加考试目标或关注考试，在这里查看重要日期。"}
              </p>
            )}
            {goals
              .filter((goal) => goal.state === "active")
              .map((goal) => {
                const source = resolvedGoalNotice(goal, listNotices());
                const hasDates = source?.content.timeline.some((point) =>
                  /^\d{4}-\d{2}-\d{2}/.test(point.value),
                );
                return (
                  <p key={goal.id}>
                    <Link
                      href={`/me/preparation?goal=${goal.id}&view=calendar`}
                      className="text-primary"
                    >
                      {CATEGORY_LABELS[goal.category]} · {goal.edition}
                    </Link>{" "}
                    · {hasDates ? "查看全部考试安排" : "时间待公布"}
                  </p>
                );
              })}
          </section>
        )}
        {view === "favorites" && (
          <section className="surface space-y-4">
            <h2 className="text-xl font-semibold">收藏的考试 · {items.length}</h2>
            {!items.length && (
              <p>
                还没有收藏，
                <Link href="/exams" className="text-primary underline">
                  前往考试中心
                </Link>
                。
              </p>
            )}
            {items.map((item) => (
              <article className="space-y-3 rounded-xl border p-5" key={item.id}>
                <h3 className="font-semibold">
                  {item.withdrawn ? (
                    item.content.title
                  ) : (
                    <Link
                      href={`/exams/${item.id}?returnTo=${encodeURIComponent("/me?view=favorites")}`}
                    >
                      {item.content.title}
                    </Link>
                  )}
                </h3>
                <p>
                  {item.changed ? "公告已更新 / 状态变化，请核对" : "已阅当前版本"} · v
                  {item.version} ·{" "}
                  <ExamStatus
                    disposition={item.withdrawn ? "公告已撤回" : item.content.disposition}
                    timeline={item.content.timeline}
                    stage={item.content.stage}
                    initialNow={now}
                  />
                </p>
                <RegistrationDeadline
                  disposition={item.withdrawn ? "公告已撤回" : item.content.disposition}
                  timeline={item.content.timeline}
                  stage={item.content.stage}
                  initialNow={now}
                />
                {item.withdrawn && (
                  <p>
                    公告已撤回，收藏和原任务版本保留。
                    <a href={item.canonical_url} className="underline">
                      查看官方来源
                    </a>
                  </p>
                )}
                <ExamActions id={item.id} saved withdrawn={item.withdrawn} />
                <form action={`/api/exams/${item.id}`}>
                  <SeenButton id={item.id} />
                </form>
              </article>
            ))}
          </section>
        )}
        {view === "reviews" && (
          <section className="surface space-y-4">
            <h2 className="text-xl font-semibold">我的材料记录</h2>
            <Link href="/tasks" className="button-primary inline-flex">
              查看全部材料预审任务
            </Link>
            {jobs.length > 0 && (
              <details>
                <summary>自动检查记录</summary>
                <div className="mt-3 space-y-3">
                  {jobs.map((job) => (
                    <p key={job.id}>
                      <Link href={`/me/goals/${job.goal_id}`} className="text-primary">
                        查看对应目标
                      </Link>{" "}
                      ·{" "}
                      {new Date(job.created_at).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}{" "}
                      ·{" "}
                      {job.status === "completed"
                        ? "已完成"
                        : job.status === "running"
                          ? "处理中"
                          : job.status === "failed"
                            ? "未完成，请查看目标"
                            : "等待处理"}
                    </p>
                  ))}
                </div>
              </details>
            )}
            {links.map((link) => {
              const task = store.canAccessTask(link.task_id, account.id)
                ? store.getTask(link.task_id)
                : undefined;
              const item = notice(link.notice_id);
              return (
                <article className="space-y-3 rounded border p-4" key={link.task_id}>
                  <p>
                    {task ? (
                      <Link href={`/tasks/${link.task_id}`} className="text-primary underline">
                        {task.name}
                      </Link>
                    ) : (
                      "任务已删除或无访问权限"
                    )}{" "}
                    · {link.stage} · {link.target || "具体对象待确认"} · 依据公告v
                    {link.notice_version}
                  </p>
                  {item ? (
                    <Link
                      href={`/exams/${item.id}?returnTo=${encodeURIComponent("/me?view=favorites")}`}
                      className="underline"
                    >
                      返回考试公告
                    </Link>
                  ) : (
                    <p>公告已撤回，原任务快照保留。</p>
                  )}
                  {item && item.version !== link.notice_version && task && (
                    <>
                      <p>
                        来源已有v{item.version}
                        ，请查看新旧原文，确认后采用。采用后需要重新核对规则并复检。
                      </p>
                      <LinkVersionActions noticeId={item.id} taskId={link.task_id} />
                    </>
                  )}
                </article>
              );
            })}
          </section>
        )}
      </div>
    </AppShell>
  );
}
import { SeenButton } from "@/components/seen-button";
