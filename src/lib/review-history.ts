import type { ReviewCheckResult, ReviewExecution, ReviewTaskDetails } from "@/domain/review";
import type { ReviewRuleSet } from "@/domain/review-rule";
import { hasCurrentRuleSources } from "@/domain/review-rule";

export function annotateExecutions(
  task: ReviewTaskDetails,
  ruleSets: ReviewRuleSet[],
  executions: ReviewExecution[],
): ReviewExecution[] {
  const latestRuleSet = ruleSets.find(
    (ruleSet) =>
      ruleSet.sourceVersion === task.noticeSource.version &&
      hasCurrentRuleSources(ruleSet, [task.noticeSource, ...task.supplementalSources]),
  );
  const currentMaterials = new Map(
    task.materials.map((material) => [material.id, material.version]),
  );
  return executions.map((execution) => {
    const reasons: string[] = [];
    if (execution.sourceVersion !== task.noticeSource.version) reasons.push("通知已经更新");
    const executionRuleSet = ruleSets.find((ruleSet) => ruleSet.id === execution.ruleSetId);
    if (
      executionRuleSet &&
      !hasCurrentRuleSources(executionRuleSet, [task.noticeSource, ...task.supplementalSources])
    )
      reasons.push("要求来源已经更新");
    if (latestRuleSet?.id !== execution.ruleSetId) reasons.push("规则草稿已经更新");
    if (
      execution.materialSnapshot.length !== currentMaterials.size ||
      execution.materialSnapshot.some(
        (material) => currentMaterials.get(material.materialId) !== material.version,
      )
    )
      reasons.push("材料清单或材料版本已经更新");
    if (!execution.metadata?.backgroundSnapshot)
      reasons.push("历史执行未记录项目背景快照，需要重新确认");
    else if (
      JSON.stringify(execution.metadata.backgroundSnapshot) !== JSON.stringify(task.background)
    )
      reasons.push("项目背景已经更新");
    return {
      ...execution,
      validity: reasons.length ? "needs_recheck" : "current",
      invalidationReasons: reasons,
    };
  });
}

export interface RecheckComparison {
  canCompare: boolean;
  resolved: string[];
  remaining: string[];
  newIssues: string[];
  unconfirmed: string[];
}

function resultKey(result: ReviewCheckResult): string {
  return JSON.stringify([
    result.source.sourceId,
    result.requirement,
    result.strength,
    result.source.quotedText,
  ]);
}

export function compareExecutions(
  current: ReviewExecution,
  previous?: ReviewExecution,
): RecheckComparison {
  const comparison: RecheckComparison = {
    canCompare: false,
    resolved: [],
    remaining: [],
    newIssues: [],
    unconfirmed: [],
  };
  if (
    !previous ||
    current.sourceVersion !== previous.sourceVersion ||
    current.ruleSetId !== previous.ruleSetId
  )
    return comparison;
  comparison.canCompare = true;
  const previousResults = new Map(previous.results.map((result) => [resultKey(result), result]));
  const currentResults = new Map(current.results.map((result) => [resultKey(result), result]));
  for (const result of current.results) {
    const before = previousResults.get(resultKey(result));
    if (!before) continue;
    if (result.verdict === "failed") {
      if (before.verdict === "failed") comparison.remaining.push(result.ruleCode);
      else if (before.verdict === "passed") comparison.newIssues.push(result.ruleCode);
      else comparison.unconfirmed.push(result.ruleCode);
    } else if (before.verdict === "failed") {
      if (result.verdict === "passed") comparison.resolved.push(result.ruleCode);
      else comparison.unconfirmed.push(result.ruleCode);
    }
  }
  for (const before of previous.results)
    if (before.verdict === "failed" && !currentResults.has(resultKey(before)))
      comparison.unconfirmed.push(before.ruleCode);
  return comparison;
}
