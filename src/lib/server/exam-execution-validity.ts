import "server-only";
import { annotateExecutions } from "@/lib/review-history";
import type { ReviewExecution, ReviewTaskDetails } from "@/domain/review";
import type { ReviewRuleSet } from "@/domain/review-rule";
import { platformDb } from "./platform-db";
import { isLegacyTestMode } from "./access-config";

export function linkedNoticeWarnings(taskId: string): string[] {
  if (isLegacyTestMode()) return [];
  const linked = platformDb()
    .prepare<
      [string],
      { notice_version: number; published_version: number | null; status: string }
    >(
      "SELECT l.notice_version,n.published_version,n.status FROM exam_task_links l JOIN exam_notices n ON n.id=l.notice_id WHERE l.task_id=?",
    )
    .get(taskId);
  if (!linked) return [];
  if (linked.status !== "published")
    return ["关联官方公告已撤回，原审查快照保留但当前适用性需复核"];
  if (linked.published_version !== linked.notice_version)
    return ["关联官方公告已有新发布版本，需核对差异并明确采用；原结果待复核"];
  return [];
}

export function annotateLinkedExecutions(
  task: ReviewTaskDetails,
  rules: ReviewRuleSet[],
  executions: ReviewExecution[],
): ReviewExecution[] {
  const warnings = linkedNoticeWarnings(task.id);
  return annotateExecutions(task, rules, executions).map((execution) =>
    warnings.length
      ? {
          ...execution,
          validity: "needs_recheck",
          invalidationReasons: [...(execution.invalidationReasons ?? []), ...warnings],
        }
      : execution,
  );
}
