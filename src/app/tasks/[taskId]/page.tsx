import { ArrowLeft, Clock3 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { TaskEditor } from "@/components/task-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewTaskIdSchema } from "@/domain/review-task";
import { hasCurrentRuleSources } from "@/domain/review-rule";
import { getReviewStore } from "@/lib/server/review-store";
import { RuleReview } from "@/components/rule-review";
import { MaterialUpload } from "@/components/material-upload";
import { ReviewExecutionPanel } from "@/components/review-execution";
import { getRuntimeStatus } from "@/lib/server/runtime-status";
import { annotateExecutions } from "@/lib/review-history";
import { TaskDeleteControl } from "@/components/task-delete-control";
import { TaskCloneControl } from "@/components/task-clone-control";
import { ClarificationPanel } from "@/components/clarification-panel";
import { SupplementSourceUpload } from "@/components/supplement-source-upload";
import { SupplementSourceRemove } from "@/components/supplement-source-remove";
import { SourceAttachments } from "@/components/source-attachments";
import { DemoControls } from "@/components/demo-controls";
import { SourceEditor } from "@/components/source-editor";
import { targetCandidates } from "@/lib/material-classification";
import { applicableRule } from "@/lib/review-checks";
import { TaskAccess } from "@/components/task-access";
import { MaterialInsights } from "@/components/material-insights";
import { LinkMaterial } from "@/components/link-material";
import { getRequirementSourceSegmentId } from "@/domain/review";

import type { Metadata } from "next";
import type { ReactElement } from "react";

export const dynamic = "force-dynamic";

interface TaskPageProps {
  params: Promise<{ taskId: string }>;
}

export async function generateMetadata({ params }: TaskPageProps): Promise<Metadata> {
  const { taskId } = await params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) return { title: "任务不存在" };
  const task = getReviewStore().getTask(taskId);
  return { title: task?.name ?? "任务不存在" };
}

export default async function TaskPage({ params }: TaskPageProps): Promise<ReactElement> {
  const { taskId } = await params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) notFound();
  const task = getReviewStore().getTask(taskId);
  if (!task) notFound();
  const ruleSets = getReviewStore().listRuleSets(taskId);
  const currentSources = [task.noticeSource, ...task.supplementalSources];
  const currentRuleSet = ruleSets.find(
    (ruleSet) =>
      ruleSet.sourceVersion === task.noticeSource.version &&
      hasCurrentRuleSources(ruleSet, currentSources),
  );
  const executions = annotateExecutions(
    task,
    ruleSets,
    getReviewStore().listReviewExecutions(taskId),
  );
  const remediationTasks = getReviewStore().listRemediationTasks(taskId);
  const runtimeStatus = getRuntimeStatus(true);
  const latestExecution = executions[0];
  const hasReviewIssues = Boolean(
    latestExecution?.validity === "needs_recheck" ||
    latestExecution?.results.some((result) =>
      ["failed", "needs_confirmation", "unable_to_check"].includes(result.verdict),
    ),
  );
  const currentStageIndex = !currentRuleSet
    ? 1
    : latestExecution?.status !== "completed"
      ? 2
      : hasReviewIssues
        ? 3
        : 4;
  const contextKey = `${ruleSets[0]?.id ?? "none"}:${task.latestUpdatedAt}:${task.materials.map((material) => `${material.id}-${material.version}`).join(",")}`;

  return (
    <AppShell activePage="task-detail">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-3">
        <Link href="/">
          <ArrowLeft aria-hidden="true" />
          返回任务列表
        </Link>
      </Button>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Badge className="mb-3">
            {!latestExecution
              ? "尚未开始审查"
              : latestExecution.validity === "needs_recheck"
                ? "待复检"
                : latestExecution.status === "running"
                  ? "正在审查"
                  : latestExecution.status === "completed"
                    ? "已有审查结果"
                    : latestExecution.status === "cancelled"
                      ? "上次已取消"
                      : "上次检查中断"}
          </Badge>
          <h1 className="break-words text-2xl font-semibold">{task.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            创建于{" "}
            <time dateTime={task.createdAt}>
              {new Date(task.createdAt).toLocaleString("zh-CN")}
            </time>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge>通知 v{task.noticeSource.version}</Badge>
          <TaskCloneControl taskId={task.id} />
          <TaskDeleteControl taskId={task.id} taskName={task.name} />
        </div>
      </div>
      <nav aria-label="任务阶段" className="mb-7 border-y border-border py-3">
        <ol className="flex flex-wrap gap-x-5 gap-y-2">
          {[
            ["导入要求", "#stage-source"],
            ["准备材料", "#stage-prepare"],
            ["审查", "#stage-review"],
            ["整改复检", "#stage-remediation"],
            ["报告与历史", "#stage-report"],
          ].map(([label, href], index) => (
            <li key={label}>
              {index < 3 || latestExecution ? (
                <a
                  href={href}
                  aria-current={index === currentStageIndex ? "step" : undefined}
                  className={
                    index === currentStageIndex
                      ? "text-xs font-semibold text-primary underline-offset-4 hover:underline"
                      : "text-xs text-muted-foreground underline-offset-4 hover:underline"
                  }
                >
                  {index < currentStageIndex
                    ? "已完成 · "
                    : index === currentStageIndex
                      ? "当前 · "
                      : "待开始 · "}
                  {label}
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">待开始 · {label}</span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          {!currentRuleSet
            ? "下一步：为当前要求来源生成或更新规则草稿。"
            : !latestExecution
              ? "下一步：可先上传材料，也可直接审查以发现必交材料缺失。"
              : latestExecution.validity === "needs_recheck"
                ? "下一步：当前结果已失效，请重新审查。"
                : hasReviewIssues
                  ? "下一步：处理问题后重新审查，再导出报告。"
                  : latestExecution.status === "completed"
                    ? "检查已完成，可查看报告与历史快照。"
                    : "下一步：完成当前审查或重试中断的检查。"}
        </p>
      </nav>
      <div id="stage-source" className="scroll-mt-6">
        <TaskEditor task={task} />
      </div>
      {task.noticeSource.inputType === "webpage" ? (
        <p className="mt-4 max-w-4xl break-words border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
          网页来源：
          <a
            className="text-primary underline"
            href={task.noticeSource.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {task.noticeSource.sourceUrl}
          </a>
          {task.noticeSource.fetchedAt ? ` · 获取于 ${task.noticeSource.fetchedAt}` : ""}
          {` · ${task.noticeSource.displayName}`}
        </p>
      ) : null}
      {task.noticeSource.inputType === "file" ? (
        <p className="mt-4 max-w-4xl break-words border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
          文件来源：{task.noticeSource.displayName} · 解析状态：{task.noticeSource.parseStatus}
        </p>
      ) : null}
      {task.supplementalSources.length > 0 ? (
        <section className="mt-4 max-w-4xl" aria-label="已添加的补充来源">
          <h2 className="text-xs font-semibold">
            已添加的补充来源（{task.supplementalSources.length}）
          </h2>
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {task.supplementalSources.map((source) => (
              <li
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
              >
                <span className="break-all">{source.displayName}</span>
                <span className="text-muted-foreground">{source.parseStatus}</span>
                {source.sourceUrl ? (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-primary underline"
                  >
                    {source.sourceUrl}
                  </a>
                ) : null}
                {source.fetchedAt ? (
                  <time dateTime={source.fetchedAt} className="text-muted-foreground">
                    获取于 {source.fetchedAt}
                  </time>
                ) : null}
                <SupplementSourceRemove
                  taskId={task.id}
                  sourceId={source.id}
                  displayName={source.displayName}
                />
                <SourceEditor
                  key={`${source.id}:${source.version}`}
                  taskId={task.id}
                  source={source}
                />
                {source.segments.map((segment) => (
                  <p
                    key={`${source.id}-${segment.paragraphIndex}`}
                    id={getRequirementSourceSegmentId(
                      source.id,
                      source.version,
                      segment.paragraphIndex,
                    )}
                    tabIndex={-1}
                    className="w-full scroll-mt-6 break-words text-muted-foreground target:rounded-sm target:bg-amber-100 target:px-2 target:py-1 target:text-foreground target:ring-2 target:ring-amber-400"
                  >
                    {segment.location ?? `段落 ${segment.paragraphIndex + 1}`} · {segment.text}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <SupplementSourceUpload taskId={task.id} />
      {task.description.startsWith("[合成演示:competition]") ? (
        <DemoControls taskId={task.id} domain="competition" />
      ) : task.description.startsWith("[合成演示:grant]") ? (
        <DemoControls taskId={task.id} domain="grant" />
      ) : null}
      <SourceAttachments
        taskId={task.id}
        sources={currentSources
          .filter((source) => source.inputType === "webpage")
          .map(({ id, displayName }) => ({ id, displayName }))}
      />
      <ClarificationPanel task={task} currentRuleSet={currentRuleSet} />
      <div id="stage-prepare" className="scroll-mt-6">
        <RuleReview
          candidates={Object.fromEntries(
            (currentRuleSet?.rules ?? []).map((rule) => [
              rule.target,
              targetCandidates(rule.target, task.materials),
            ]),
          )}
          applicability={Object.fromEntries(
            (currentRuleSet?.rules ?? []).map((rule) => [
              rule.id,
              applicableRule(rule, task.background),
            ]),
          )}
          key={`rules-${ruleSets[0]?.id ?? "none"}`}
          taskId={task.id}
          currentNoticeVersion={task.noticeSource.version}
          sources={currentSources}
          materials={task.materials.map(({ id, version, originalFileName }) => ({
            id,
            version,
            originalFileName,
          }))}
          initialRuleSets={ruleSets}
          mode={runtimeStatus.mode}
        />
        <MaterialUpload key={task.id} taskId={task.id} initialMaterials={task.materials} />
        <LinkMaterial taskId={task.id} />
        <MaterialInsights task={task} />
        <TaskAccess taskId={task.id} />
      </div>
      <ReviewExecutionPanel
        key={`execution-${latestExecution?.id ?? "none"}-${contextKey}`}
        taskId={task.id}
        initialExecutions={executions}
        initialRemediationTasks={remediationTasks}
        hasCurrentRuleSet={Boolean(currentRuleSet)}
        mode={runtimeStatus.mode}
        materials={task.materials.map(({ id, version, originalFileName }) => ({
          id,
          version,
          originalFileName,
        }))}
        sources={[
          ...task.noticeHistory.map(({ id, version, displayName }) => ({
            id,
            version,
            displayName,
          })),
          ...task.supplementalSources.map(({ id, version, displayName }) => ({
            id,
            version,
            displayName,
          })),
        ]}
      />
      <section
        aria-labelledby="notice-history-heading"
        className="mt-12 max-w-4xl border-t border-border pt-7"
      >
        <div className="mb-5 flex items-center gap-2">
          <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="notice-history-heading" className="text-sm font-semibold">
            通知原文版本
          </h2>
        </div>
        <ol className="space-y-4">
          {task.noticeHistory.map((version) => (
            <li key={version.version} className="border-l-2 border-border pl-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-medium">
                  版本 {version.version}
                  {version.version === task.noticeSource.version ? " · 当前版本" : ""}
                </h3>
                <time className="text-xs text-muted-foreground" dateTime={version.createdAt}>
                  {new Date(version.createdAt).toLocaleString("zh-CN")}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                {version.originalText}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-primary">查看原文段落位置</summary>
                <ol className="mt-3 space-y-2">
                  {version.segments.map((segment) => (
                    <li
                      id={getRequirementSourceSegmentId(
                        task.noticeSource.id,
                        version.version,
                        segment.paragraphIndex,
                      )}
                      key={segment.paragraphIndex}
                      tabIndex={-1}
                      className="scroll-mt-6 rounded-md bg-muted/50 px-3 py-2 text-xs leading-6 target:bg-amber-100 target:ring-2 target:ring-amber-400"
                    >
                      <span className="mr-2 font-mono text-muted-foreground">
                        段落 {segment.paragraphIndex + 1} · 字符 {segment.startOffset}–
                        {segment.endOffset}
                      </span>
                      <span className="whitespace-pre-wrap break-words">{segment.text}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </AppShell>
  );
}
