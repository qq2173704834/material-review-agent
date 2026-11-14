import { goalReviewReadiness } from "@/lib/server/goal-review";
import { getReviewStore } from "@/lib/server/review-store";
import { GoalReviewControls } from "@/components/goal-review-controls";
import { platformDb } from "@/lib/server/platform-db";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import { sessionAccount } from "@/lib/server/account-auth";
import { studentGoal } from "@/lib/server/student-goals";
import { notice, noticeVersion } from "@/lib/server/exam-store";
import { ExamActions } from "@/components/exam-actions";
export const dynamic = "force-dynamic";
export default async function GoalPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}): Promise<ReactElement> {
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!account) notFound();
  const goal = studentGoal(account.id, (await params).goalId);
  if (!goal) notFound();
  const current = goal.noticeId ? notice(goal.noticeId) : undefined;
  const adopted =
    goal.noticeId && goal.noticeVersion
      ? noticeVersion(goal.noticeId, goal.noticeVersion)
      : undefined;
  const task = goal.taskId ? getReviewStore().getTask(goal.taskId) : undefined;
  const last =
    task && getReviewStore().taskOwner(task.id) === account.id
      ? getReviewStore().listReviewExecutions(task.id)[0]
      : undefined;
  const jobs = platformDb()
    .prepare<[string, string], { id: string; status: string; reason: string; created_at: string }>(
      "SELECT id,status,reason,created_at FROM portal_jobs WHERE user_id=? AND goal_id=? ORDER BY created_at DESC LIMIT 20",
    )
    .all(account.id, goal.id);
  return (
    <AppShell activePage="me">
      <div className="space-y-6">
        <Link href="/me" className="underline">
          返回个人中心
        </Link>
        <h1 className="text-3xl font-semibold">考试目标 · 材料准备</h1>
        <p>
          {goal.category} · {goal.region} · {goal.edition} · {goal.subject || "科目待确认"}
        </p>
        <p>
          目标状态：{goal.state}；进度：{goal.progress || "尚未记录"}
        </p>
        <Link className="underline" href={`/learn?goal=${goal.id}`}>
          查看目标学习资源
        </Link>
        {current ? (
          <section className="space-y-4 rounded border p-5">
            <h2 className="text-xl font-semibold">关联公告：{current.content.title}</h2>
            <p>
              目标保存版本 v{goal.noticeVersion}；当前已发布 v{current.version}
              。公告变化需核对差异后明确采用，不能自动覆盖规则。
            </p>
            <p>具体阶段、岗位及附件应逐项确认。材料不完整或资格未知时，结果保留待确认。</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">
              {adopted?.content.text ?? "保存版本不可读取，请重新核对来源。"}
            </pre>
            <Link className="underline" href={`/exams/${current.id}`}>
              查看公告原文、附件与历史
            </Link>
            <ExamActions id={current.id} />
            <GoalReviewControls goalId={goal.id} enabled={goal.autoReview} taskId={goal.taskId} />
          </section>
        ) : (
          <section className="rounded border p-5">
            <p>
              尚无可用的关联公告。请先从考试中心找到适用地区、考期和阶段的已审核公告，再编辑目标进行关联；不会用通用目录替代资格依据。
            </p>
            <Link href="/exams" className="underline">
              选择官方考试公告
            </Link>
          </section>
        )}
        <section className="space-y-2">
          <h2 className="font-semibold">自动执行记录</h2>
          <p>{goalReviewReadiness(account.id, goal.id)}</p>
          {last && (
            <div className="rounded border p-3">
              <p>
                上次实际执行：{last.completedAt || last.createdAt} · {last.status} · 已执行
                {last.results.length}项，未执行{last.unexecutedCount}项。
              </p>
              <p>
                五类结果：通过{last.results.filter((item) => item.verdict === "passed").length} ·
                未通过{last.results.filter((item) => item.verdict === "failed").length} · 待确认
                {last.results.filter((item) => item.verdict === "needs_confirmation").length} ·
                无法检查{last.results.filter((item) => item.verdict === "unable_to_check").length} ·
                不适用{last.results.filter((item) => item.verdict === "not_applicable").length}
              </p>
              <Link className="underline" href={`/tasks/${goal.taskId}`}>
                核对当前版本有效性、逐项原文证据、整改与复检
              </Link>
            </div>
          )}
          {jobs.length ? (
            jobs.map((job) => (
              <p key={job.id}>
                {job.created_at} · {job.status} · {job.reason}
              </p>
            ))
          ) : (
            <p>暂无自动执行记录；尚未执行不算通过。</p>
          )}
        </section>
        <Link className="underline" href="/tasks">
          查看材料预审与历史任务
        </Link>
      </div>
    </AppShell>
  );
}
