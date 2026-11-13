import { Clock3 } from "lucide-react";
import { notFound } from "next/navigation";

import { TaskWorkspace } from "@/components/task-workspace";
import { AppShell } from "@/components/app-shell";
import { TaskEditor } from "@/components/task-editor";
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
  return (
    <AppShell activePage="task-detail">
      <TaskWorkspace
        task={task}
        initialExecution={latestExecution}
        mode={runtimeStatus.mode}
        hasModelConfiguration={runtimeStatus.hasModelConfiguration}
        sources={
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              通知、指南、模板属于审查依据。它们告诉系统按什么要求检查。
            </p>
            <TaskEditor task={task} />
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
                文件来源：{task.noticeSource.displayName} · 解析状态：
                {
                  {
                    text_extracted: "已读取",
                    partial: "部分读取",
                    failed: "读取失败",
                    ocr_required: "需要文字识别",
                  }[task.noticeSource.parseStatus]
                }
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
                      <span className="text-muted-foreground">
                        {
                          {
                            text_extracted: "已读取",
                            partial: "部分读取",
                            failed: "读取失败",
                            ocr_required: "需要文字识别",
                          }[source.parseStatus]
                        }
                      </span>
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
                          {segment.location ?? `段落 ${segment.paragraphIndex + 1}`} ·{" "}
                          {segment.text}
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
          </>
        }
        materials={
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              申请书、证明、项目文件等放在这里。选择后自动上传，原件和修订版本均会保留。
            </p>
            <MaterialUpload key={task.id} taskId={task.id} initialMaterials={task.materials} />
            <LinkMaterial taskId={task.id} />
            <MaterialInsights task={task} />
          </>
        }
        requirements={
          <div id="stage-prepare">
            {" "}
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
          </div>
        }
        clarification={
          <>
            <ClarificationPanel task={task} currentRuleSet={currentRuleSet} />
            <p className="mt-4 text-sm">
              来源有冲突时，可在审查要求中查看双方原文并选择依据；也可暂时跳过，仅将相关项保留不确定。
            </p>
          </>
        }
        review={
          <>
            {" "}
            <ReviewExecutionPanel
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
          </>
        }
        history={
          <>
            {" "}
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
                      <summary className="cursor-pointer text-xs text-primary">
                        查看原文段落位置
                      </summary>
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
          </>
        }
        controls={
          <>
            <TaskAccess taskId={task.id} />
            <TaskCloneControl taskId={task.id} />
            <TaskDeleteControl taskId={task.id} taskName={task.name} />
          </>
        }
      />
    </AppShell>
  );
}
