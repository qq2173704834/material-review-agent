import { savedLearningItems } from "@/lib/server/learning-store";
import { LearningActions } from "@/components/learning-actions";
import { isUpcoming } from "@/lib/portal-feed";
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
import { favorites, notice, registrationState } from "@/lib/server/exam-store";
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
  const filters = await searchParams;
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
  const items = favorites(account.id);
  const store = getReviewStore();
  const links = platformDb()
    .prepare<
      [string],
      { notice_id: string; task_id: string; notice_version: number; stage: string; target: string }
    >("SELECT * FROM exam_task_links WHERE user_id=?")
    .all(account.id);
  const nodes = items
    .filter((item) => item.status !== "withdrawn" && item.content.disposition === "正常")
    .flatMap((item) =>
      item.content.timeline
        .filter((point) => isUpcoming(point.value))
        .map((point) => ({ id: item.id, title: item.content.title, ...point })),
    )
    .sort((a, b) => a.value.localeCompare(b.value));
  return (
    <AppShell activePage="me">
      <div className="space-y-7">
        <header>
          <h1 className="text-3xl font-semibold">我的考试工作台</h1>
          <p className="mt-3">这里汇总你的考试目标、学习进度、收藏与材料准备。</p>
          <div className="mt-4 space-y-2 rounded-xl border bg-card p-4" aria-label="当前登录身份">
            <p>
              当前登录用户名：<strong>{account.username}</strong>
            </p>
            <p className="text-sm text-muted-foreground">昵称：{account.nickname}</p>
            <Link href="/account" className="inline-block text-sm text-primary underline">
              账号设置与退出登录
            </Link>
          </div>
        </header>
        <section className="space-y-2">
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
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">收藏的学习资料与更新</h2>
          {resources.length ? (
            resources.map((item) => (
              <article key={item.id} className="rounded border p-3">
                <Link href={`/learn/${item.id}`} className="underline">
                  {item.content.title}
                </Link>
                <p>
                  v{item.version} ·{" "}
                  {item.status === "withdrawn"
                    ? "已撤回，请核对来源"
                    : item.seen
                      ? "当前版本已看（不代表学习完成）"
                      : "当前版本未读 / 有更新"}
                </p>
                <LearningActions id={item.id} saved seen={item.seen} />
              </article>
            ))
          ) : (
            <p>暂无学习资料收藏，可到学习页选择。</p>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">材料预审执行提示</h2>
          {jobs.length ? (
            jobs.map((job) => (
              <p key={job.id}>
                <Link href={`/me/goals/${job.goal_id}`} className="underline">
                  查看对应目标
                </Link>{" "}
                · {job.created_at} · {job.status} · {job.reason}
              </p>
            ))
          ) : (
            <p>暂无自动预审执行。未开启时可手动审查。</p>
          )}
        </section>
        <StudentGoals
          goals={goals}
          notices={listNotices()}
          newCategory={filters.newCategory}
          noticeId={filters.noticeId}
        />
        <Link href="/tasks" className="inline-block underline">
          历史与通用材料预审任务
        </Link>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">收藏时间节点 · Asia/Shanghai</h2>
          {nodes.length ? (
            nodes.map((node, index) => (
              <p key={`${node.id}-${index}`}>
                <Link className="text-primary underline" href={`/exams/${node.id}`}>
                  {node.title}
                </Link>{" "}
                · {node.label}：{node.value}
                {Date.parse(node.value) < new Date().getTime() ? "（已到日期，请核对时刻）" : ""}
                {node.value.length === 10 ? "（仅日期）" : ""}
              </p>
            ))
          ) : (
            <p>暂无已确认节点，未知日期不会自动估算。</p>
          )}
        </section>
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">我的收藏 · {items.length}</h2>
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
                  <Link href={`/exams/${item.id}`}>{item.content.title}</Link>
                )}
              </h3>
              <p>
                {item.changed ? "公告已更新 / 状态变化，请核对" : "已阅当前版本"} · v{item.version}{" "}
                · {registrationState(item.content)}
              </p>
              {item.withdrawn && (
                <p>
                  公告已撤回，收藏和原任务版本保留。
                  <a href={item.canonical_url} className="underline">
                    查看官方来源
                  </a>
                </p>
              )}
              <p className="text-xs">最近成功核查：{item.last_success || "未自动核查"}</p>
              <ExamActions id={item.id} saved withdrawn={item.withdrawn} />
              <form action={`/api/exams/${item.id}`}>
                <SeenButton id={item.id} />
              </form>
            </article>
          ))}
        </section>
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">关联预审任务</h2>
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
                  <Link href={`/exams/${item.id}`} className="underline">
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
      </div>
    </AppShell>
  );
}
import { SeenButton } from "@/components/seen-button";
