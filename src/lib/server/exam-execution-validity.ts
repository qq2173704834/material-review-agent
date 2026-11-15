import "server-only";
import { annotateExecutions } from "@/lib/review-history";
import type { ReviewExecution, ReviewTaskDetails } from "@/domain/review";
import type { ReviewRuleSet } from "@/domain/review-rule";
import { platformDb } from "./platform-db";
import { isLegacyTestMode } from "./access-config";

export function linkedNoticeWarnings(taskId: string): string[] {
  if (isLegacyTestMode()) return [];
  const db = platformDb();
  const campusWarnings: string[] = [];
  if (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='campus_review_links'")
      .get()
  ) {
    const campus = db
      .prepare<[string], { digest: string; payload: string | null }>(
        "SELECT l.digest,n.payload FROM campus_review_links l LEFT JOIN campus_notices n ON n.id=l.notice_id WHERE l.task_id=?",
      )
      .get(taskId);
    if (campus) {
      const source = campus.payload
        ? (JSON.parse(campus.payload) as { digest: string; withdrawn?: boolean })
        : undefined;
      if (!source || source.withdrawn)
        campusWarnings.push("关联校园通知已撤回或不可用，原材料结果保留，当前适用性待复检");
      else if (source.digest !== campus.digest)
        campusWarnings.push("关联校园通知已更新，需核对新要求，原材料结果待复检");
    }
  }
  const linked = db
    .prepare<
      [string],
      { notice_version: number; published_version: number | null; status: string }
    >(
      "SELECT l.notice_version,n.published_version,n.status FROM exam_task_links l JOIN exam_notices n ON n.id=l.notice_id WHERE l.task_id=?",
    )
    .get(taskId);
  if (!linked) return campusWarnings;
  if (linked.status !== "published")
    return [...campusWarnings, "关联官方公告已撤回，原审查快照保留但当前适用性需复核"];
  if (linked.published_version !== linked.notice_version)
    return [...campusWarnings, "关联官方公告已有新发布版本，需核对差异并明确采用；原结果待复核"];
  return campusWarnings;
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
