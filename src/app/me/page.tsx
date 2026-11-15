import { examTimeline } from "@/lib/exam-timeline";
import { personalSchedule } from "@/lib/server/personal-schedule";
import { safeBrowseReturn } from "@/lib/browse-return";
import { savedLearningItems } from "@/lib/server/learning-store";
import { learningEntries } from "@/lib/server/learning-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { LearningActions } from "@/components/learning-actions";
import { ExamStatus, RegistrationDeadline } from "@/components/registration-deadline";
import { requestTime } from "@/lib/server/request-time";
import { StudentGoals } from "@/components/student-goals";
import { studentGoals } from "@/lib/server/student-goals";
import { listNotices } from "@/lib/server/exam-store";
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

  return (
    <AppShell activePage="me">
      <div className="space-y-7">
        <header className="page-heading">
          <h1 className="text-3xl font-semibold">我的备考</h1>
          <p className="mt-3">选定目标，安排学习，把每一次准备落到实处。</p>
        </header>
        <details className="content-settings" open={view !== "overview"}>
          <summary>收藏与个人工具</summary>
          <nav className="page-tabs mt-3" aria-label="个人工具导航">
            {[
              ["overview", "考试目标"],
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
        </details>
        {view === "overview" && (
          <>
            <StudentGoals
              key={`${account.id}-${filters.editGoal || "default"}`}
              editingGoalId={filters.editGoal}
              returnTo={filters.returnTo ? safeBrowseReturn(filters.returnTo, "/me") : undefined}
              goals={goals}
              notices={listNotices()}
              newCategory={filters.newCategory}
              noticeId={filters.noticeId}
              scheduleNodes={personalSchedule(account.id)}
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
                  {item.changed ? "未读 · 公告有更新" : "已读"} ·{" "}
                  <ExamStatus
                    title={item.content.title}
                    disposition={item.withdrawn ? "公告已撤回" : item.content.disposition}
                    timeline={examTimeline(item.content)}
                    stage={item.content.stage}
                    initialNow={now}
                  />
                </p>
                <RegistrationDeadline
                  disposition={item.withdrawn ? "公告已撤回" : item.content.disposition}
                  timeline={examTimeline(item.content)}
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
                  {item.changed && !item.withdrawn && <SeenButton id={item.id} />}
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
