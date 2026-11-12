import { ArrowLeft, Clock3 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { TaskEditor } from "@/components/task-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewTaskIdSchema } from "@/domain/review-task";
import { getReviewStore } from "@/lib/server/review-store";
import { RuleReview } from "@/components/rule-review";
import { MaterialUpload } from "@/components/material-upload";
import { ReviewExecutionPanel } from "@/components/review-execution";

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
  const executions = getReviewStore().listReviewExecutions(taskId);

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
          <Badge className="mb-3">尚未开始审查</Badge>
          <h1 className="break-words text-2xl font-semibold">{task.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            创建于{" "}
            <time dateTime={task.createdAt}>
              {new Date(task.createdAt).toLocaleString("zh-CN")}
            </time>
          </p>
        </div>
        <Badge>通知 v{task.noticeSource.version}</Badge>
      </div>
      <TaskEditor task={task} />
      <RuleReview
        taskId={task.id}
        currentNoticeVersion={task.noticeSource.version}
        initialRuleSets={ruleSets}
      />
      <MaterialUpload taskId={task.id} initialMaterials={task.materials} />
      <ReviewExecutionPanel
        taskId={task.id}
        initialExecutions={executions}
        hasCurrentRuleSet={ruleSets.some(
          (ruleSet) => ruleSet.sourceVersion === task.noticeSource.version,
        )}
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
                      key={segment.paragraphIndex}
                      className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-6"
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
