import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import { PreparationCenter, type PrepMaterial } from "@/components/preparation-center";
import { sessionAccount } from "@/lib/server/account-auth";
import { studentGoals } from "@/lib/server/student-goals";
import { preparationState, preparationResources } from "@/lib/server/preparation-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { learningEntries } from "@/lib/server/learning-store";
import { listNotices } from "@/lib/server/exam-store";
import { resolvedGoalNotice } from "@/lib/goal-schedule";
import { requestTime } from "@/lib/server/request-time";
import { getReviewStore } from "@/lib/server/review-store";
import { annotateLinkedExecutions } from "@/lib/server/exam-execution-validity";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!account) redirect("/login?next=%2Fme%2Fpreparation");
  const filters = await searchParams,
    goals = studentGoals(account.id),
    goal = filters.goal
      ? goals.find((goal) => goal.id === filters.goal)
      : (goals.find((goal) => goal.state === "active") ?? goals[0]);
  if (filters.goal && !goal) notFound();
  if (!goal)
    return (
      <AppShell activePage="me">
        <section className="surface">
          <h1 className="text-3xl font-semibold">备考中心</h1>
          <p className="my-4">添加一个考试目标，开始安排自己的备考路线。</p>
          <Link className="button-primary" href="/me">
            ＋ 添加考试目标
          </Link>
          <Link className="button-secondary ml-2" href="/exams">
            浏览考试
          </Link>
        </section>
      </AppShell>
    );
  const source = resolvedGoalNotice(goal, listNotices());
  const events =
    goal.state === "active" &&
    source?.content.disposition === "正常" &&
    !catalogLifecycle(learningEntries(), goal.category, goal.region).blocked
      ? source.content.timeline
          .filter(
            (point) =>
              /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(point.value) &&
              Number.isFinite(Date.parse(point.value)),
          )
          .map((point, index) => ({
            id: `${source.id}-${index}`,
            date: point.value,
            label: point.label,
            title: source.content.title,
            href: `/exams/${source.id}`,
          }))
      : [];
  const store = getReviewStore(),
    task =
      goal.taskId && store.canAccessTask(goal.taskId, account.id)
        ? store.getTask(goal.taskId)
        : undefined;
  const execution = task
    ? annotateLinkedExecutions(
        task,
        store.listRuleSets(task.id),
        store.listReviewExecutions(task.id),
      )[0]
    : undefined;
  const materials: PrepMaterial[] =
    execution?.results.map((result, index) => ({
      id: `${result.ruleId}-${index}`,
      name: result.requirement,
      verdict: result.verdict,
      taskId: task!.id,
      executionId: execution.id,
      sourceVersion: execution.sourceVersion,
      source: result.source,
      recommendation: result.recommendation,
      references: result.evidence,
      evidence: [
        result.reason,
        ...result.evidence.map((evidence) => {
          const file = task!.materials.find((material) => material.id === evidence.materialId);
          return `${file?.originalFileName ?? "材料"} · v${evidence.materialVersion} · ${evidence.location}\n${evidence.quotedText}`;
        }),
      ].join("\n\n"),
      href: `/tasks/${task!.id}?view=results&returnTo=${encodeURIComponent(`/me/preparation?goal=${goal.id}&view=materials`)}`,
    })) ?? [];
  if (task) {
    const rules = store
      .listRuleSets(task.id)
      .find((set) => (execution ? set.id === execution.ruleSetId : set.status === "completed"));
    for (const rule of rules?.rules ?? []) {
      if (materials.some((item) => item.id.startsWith(`${rule.id}-`))) continue;
      materials.push({
        id: rule.id,
        name: rule.description,
        verdict: "not_started",
        taskId: task.id,
        executionId: "",
        sourceVersion: rules!.sourceVersion,
        source: rule.source,
        recommendation: "上传对应材料并运行自查。",
        references: [],
        evidence: `要求原文：${rule.source.quotedText}`,
        href: `/tasks/${task.id}?view=prepare&returnTo=${encodeURIComponent(`/me/preparation?goal=${goal.id}&view=materials`)}`,
      });
    }
  }
  const status = execution
    ? execution.validity === "needs_recheck"
      ? "材料或要求有变化，结果待复检"
      : `${execution.status === "running" ? "自查进行中" : execution.status === "cancelled" ? "自查已取消" : execution.status === "completed" ? "自查已完成" : "自查中断"} · 已检查${execution.results.length}项；未执行${execution.unexecutedCount}项`
    : "尚未运行自查";
  return (
    <AppShell activePage="me">
      <PreparationCenter
        key={`${account.id}-${goal.id}`}
        goal={goal}
        goals={goals}
        initialState={preparationState(account.id, goal.id)}
        initialView={filters.view ?? "overview"}
        initialStage={filters.stage ?? ""}
        events={events}
        resources={preparationResources(account.id, goal.id).map((item) => ({
          id: item.id,
          version: item.version,
          title: item.content.title,
          stage: item.content.studyStage,
          subject: item.content.subject,
          reason: `${item.content.subject || "目标相关资料"} · ${item.content.studyStage}阶段`,
        }))}
        materials={materials}
        files={
          task?.materials.map((file) => ({
            id: file.id,
            name: file.originalFileName,
            version: file.version,
            parseStatus: file.parseStatus,
            taskId: task.id,
          })) ?? []
        }
        materialStatus={`${execution?.metadata?.mode === "mock" ? "模拟自查 · " : ""}${status} · 当前已上传${task?.materials.length ?? 0}份材料`}
        initialNow={await requestTime()}
      />
    </AppShell>
  );
}
