import { compareExecutions } from "@/lib/review-history";
import { reviewSummary } from "@/lib/review-summary";

import type { ReviewExecution, ReviewTaskDetails, ReviewVerdict } from "@/domain/review";
import type { ReviewRuleSet } from "@/domain/review-rule";

const verdictLabels: Record<ReviewVerdict, string> = {
  passed: "通过",
  failed: "未通过",
  needs_confirmation: "待确认",
  unable_to_check: "无法检查",
  not_applicable: "不适用",
};

function plain(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+!|]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}

function sourceSummary(source: ReviewTaskDetails["noticeSource"]): string {
  const address = source.sourceUrl ? ` · ${plain(source.sourceUrl)}` : "";
  return `- ${plain(source.displayName)} · ${source.inputType} · v${source.version} · ${source.parseStatus}${address}`;
}

function ruleSourceLabel(source: { displayName: string; version: number }): string {
  return `${plain(source.displayName)} · v${source.version}`;
}

export function createReviewReport(
  task: ReviewTaskDetails,
  execution: ReviewExecution,
  ruleSet: ReviewRuleSet,
  previous?: ReviewExecution,
  detailed = false,
): string {
  if (!detailed) return createSimpleReport(task, execution);
  const lines = [
    `# ${plain(task.name)} · 材料预审报告`,
    "",
    `- 导出时间：${new Date().toISOString()}`,
    `- 任务 ID：${task.id}`,
    `- 执行 ID：${execution.id}`,
    `- 主通知来源：${sourceSummary(task.noticeHistory.find((source) => source.version === execution.sourceVersion) ?? task.noticeSource).slice(2)}`,
    `- 规则来源快照：${ruleSet.sourceVersions.map(ruleSourceLabel).join("；")}`,
    `- 规则集：${execution.ruleSetId}`,
    ...(execution.metadata?.mode === "mock" ? ["- 模拟演示，不代表真实内容核验。"] : []),
    `- 执行状态：${{ running: "执行中", completed: "已完成", cancelled: "已取消", failed: "执行中断" }[execution.status]}`,
    `- 开始时间：${execution.createdAt}`,
    `- 结束时间：${execution.completedAt || "尚未结束"}`,
    `- 有效性：${execution.validity === "needs_recheck" ? `待复检（${execution.invalidationReasons?.map(plain).join("；")}）` : "对应当前版本"}`,
    `- 未执行：${execution.unexecutedCount} 项`,
    "",
    "## 结果统计",
    "",
    "| 判定 | 数量 |",
    "| --- | ---: |",
    ...Object.entries(verdictLabels).map(
      ([verdict, label]) =>
        `| ${label} | ${execution.results.filter((result) => result.verdict === verdict).length} |`,
    ),
    "",
    `必需项未通过：${execution.results.filter((result) => result.strength === "required" && result.verdict === "failed").length}；建议/可选项未满足：${execution.results.filter((result) => result.strength !== "required" && result.verdict === "failed").length}。`,
    "未执行、证据不足和解析失败的项目不计为通过。报告仅反映本次预审，不构成官方审核结论。",
    "",
    "## 材料快照",
    "",
    ...execution.materialSnapshot.map((snapshot) => {
      const material = task.materials.find(
        (candidate) =>
          candidate.id === snapshot.materialId && candidate.version === snapshot.version,
      );
      return `- ${material ? plain(material.originalFileName) : snapshot.materialId} · v${snapshot.version}${material ? ` · ${material.parseStatus} · ${plain(material.parseMessage)}` : "（当前界面已是其他版本，证据见逐项记录）"}`;
    }),
  ];
  const sourcesAddedAfterExecution = task.supplementalSources.filter(
    (source) => !ruleSet.sourceVersions.some((snapshot) => snapshot.sourceId === source.id),
  );
  if (sourcesAddedAfterExecution.length)
    lines.push(
      "",
      "## 执行后新增的补充来源（导出时状态）",
      "",
      ...sourcesAddedAfterExecution.map(sourceSummary),
      "以上来源不在本次规则来源快照中，未参与本次规则提取与检查。",
    );
  if (!execution.materialSnapshot.length) lines.push("- 本次没有上传材料。");
  const comparison = compareExecutions(execution, previous);
  if (comparison.canCompare)
    lines.push(
      "",
      "## 复检对比",
      "",
      `与执行 ${previous?.id} 比较：已解决 ${comparison.resolved.length}，仍存在 ${comparison.remaining.length}，新增 ${comparison.newIssues.length}，变化待确认 ${comparison.unconfirmed.length}。`,
      "只将同一规则从未通过变为通过计为已解决；待确认、未执行和不适用不自动算已解决。",
    );
  lines.push("", "## 逐项结果", "");
  for (const result of execution.results) {
    const mergedSources =
      ruleSet.rules.find((rule) => rule.id === result.ruleId)?.additionalSources ?? [];
    if (mergedSources.length)
      lines.push(
        ...mergedSources.map(
          (source) =>
            `等价要求补充来源：${plain(source.displayName ?? "来源")} v${source.sourceVersion} · 段落 ${source.paragraphIndex + 1} · ${plain(source.quotedText)}`,
        ),
        "",
      );
    if (result.reusedFrom)
      lines.push(
        `复用结果：原执行 ${result.reusedFrom.executionId}，原检查时间 ${result.reusedFrom.checkedAt}；本轮未重复调用。`,
        "",
      );
    lines.push(
      `### ${result.ruleCode} · ${verdictLabels[result.verdict]}`,
      "",
      `- 要求：${plain(result.requirement)}`,
      `- 强度：${{ required: "必须", recommended: "建议", optional: "可选", unknown: "待确认" }[result.strength]}`,
      `- 检查方式：${result.method === "model" ? "真实模型辅助审查" : result.method === "unavailable" ? "未能检查" : "确定性工具/适用性判断"}`,
      `- 原因：${plain(result.reason)}`,
      `- 建议：${plain(result.recommendation) || "无"}`,
      `- 要求依据：${plain(result.source.displayName ?? "主通知")} v${result.source.sourceVersion ?? execution.sourceVersion}，段落 ${result.source.paragraphIndex + 1}，${plain(result.source.quotedText)}`,
    );
    if (result.coverage)
      lines.push(
        `- 片段覆盖：${result.coverage.examinedSegments}/${result.coverage.totalSegments}；${result.coverage.isComplete ? "已解析文本完整纳入本项上下文" : "存在片段截断或文件未完整解析"}`,
      );
    for (const evidence of result.evidence)
      lines.push(
        `- 材料证据：${evidence.materialId} · v${evidence.materialVersion} · ${plain(evidence.location)} · ${plain(evidence.quotedText)}`,
      );
    if (!result.evidence.length)
      lines.push("- 材料证据：无；请结合原因判断缺失、能力限制或适用性。");
    const resolution = execution.humanResolutions?.find((item) => item.ruleId === result.ruleId);
    if (resolution)
      lines.push(
        `- 人工复核意见：${{ confirmed: "认为符合", rejected: "认为不符合", deferred: "暂不确认" }[resolution.decision]} · ${plain(resolution.note) || "未填写依据"} · ${resolution.updatedAt}`,
        "- 人工意见独立于上方系统判定，不代表自动复检结果。",
      );
    lines.push("");
  }
  if (execution.metadata?.materialConsistency?.length) {
    lines.push("## 材料信息核对（系统自查建议）", "");
    for (const check of execution.metadata.materialConsistency) {
      lines.push(
        `### ${plain(check.field)} · ${verdictLabels[check.verdict]}`,
        plain(check.reason),
        plain(check.recommendation),
      );
      for (const evidence of check.evidence)
        lines.push(
          `- ${plain(evidence.location)} · ${plain(evidence.quotedText)} · 材料${evidence.materialId}`,
        );
      lines.push("");
    }
  }
  if (execution.metadata?.limitations?.length)
    lines.push(
      "## 尚需核对的内容",
      "",
      ...execution.metadata.limitations.map((item) => `- ${plain(item)}`),
      "",
    );
  return lines.join("\n");
}

export function createRemediationReport(
  task: ReviewTaskDetails,
  execution: ReviewExecution,
  ruleSet: ReviewRuleSet,
  detailed = false,
): string {
  if (!detailed) return createSimpleReport(task, execution, true);
  const actionable = execution.results.filter(
    (result) =>
      (result.strength === "required" && result.verdict === "failed") ||
      result.verdict === "needs_confirmation" ||
      result.verdict === "unable_to_check",
  );
  const lines = [
    `# ${plain(task.name)} · 整改与确认清单`,
    "",
    `- 执行 ID：${execution.id}`,
    `- 检查时间：${execution.completedAt || execution.createdAt}`,
    `- 主通知来源：${sourceSummary(task.noticeHistory.find((source) => source.version === execution.sourceVersion) ?? task.noticeSource).slice(2)}`,
    `- 规则来源快照：${ruleSet.sourceVersions.map(ruleSourceLabel).join("；")}`,
    `- 清单项目：${actionable.length}`,
    "",
    "此清单只汇总需要处理或人工确认的项目，不记录整改完成状态，也不表示复检通过。",
    "",
  ];
  const sourcesAddedAfterExecution = task.supplementalSources.filter(
    (source) => !ruleSet.sourceVersions.some((snapshot) => snapshot.sourceId === source.id),
  );
  if (sourcesAddedAfterExecution.length)
    lines.push(
      "",
      "## 执行后新增的补充来源（导出时状态）",
      "",
      ...sourcesAddedAfterExecution.map(sourceSummary),
      "以上来源不在本次规则来源快照中，未参与本次规则提取与检查。",
    );
  if (!actionable.length) lines.push("本次没有明确的必须项失败或待确认事项。", "");
  for (const result of actionable) {
    lines.push(
      `## ${result.ruleCode} · ${{ failed: "未通过", needs_confirmation: "待确认", unable_to_check: "无法检查" }[result.verdict as "failed" | "needs_confirmation" | "unable_to_check"]}`,
      "",
      `- 要求：${plain(result.requirement)}`,
      `- 强度：${{ required: "必须", recommended: "建议", optional: "可选", unknown: "待确认" }[result.strength]}`,
      `- 原因：${plain(result.reason)}`,
      `- 建议：${plain(result.recommendation) || "请对照要求人工处理。"}`,
      `- 要求依据：${plain(result.source.displayName ?? "主通知")} v${result.source.sourceVersion ?? execution.sourceVersion} · 段落 ${result.source.paragraphIndex + 1} · ${plain(result.source.quotedText)}`,
      ...(result.evidence.length
        ? result.evidence.map(
            (evidence) =>
              `- 材料证据：${evidence.materialId} · v${evidence.materialVersion} · ${plain(evidence.location)} · ${plain(evidence.quotedText)}`,
          )
        : ["- 材料证据：无"]),
      ...(
        execution.humanResolutions?.filter((item) => item.ruleId === result.ruleId) ?? []
      ).flatMap((resolution) => [
        `- 人工复核意见：${{ confirmed: "认为符合", rejected: "认为不符合", deferred: "暂不确认" }[resolution.decision]} · ${plain(resolution.note) || "未填写依据"} · ${resolution.updatedAt}`,
        "- 人工意见独立于系统判定，不代表复检通过。",
      ]),
      "",
    );
  }
  return lines.join("\n");
}

/** A readable snapshot: verdict, changes to make, and the evidence needed to act. */
function createSimpleReport(
  task: ReviewTaskDetails,
  execution: ReviewExecution,
  onlyActionable = false,
): string {
  const summary = reviewSummary(execution);
  const lines = [
    `# ${plain(task.name)} · ${onlyActionable ? "修改与确认清单" : "材料自查结果"}`,
    "",
    `## ${summary.title}`,
    summary.description,
    `检查时间：${new Date(execution.completedAt || execution.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`,
    `需修改 ${summary.failed} 项 · 待确认 / 未完成 ${summary.pending} 项 · 已通过 ${summary.passed} 项`,
    ...(execution.metadata?.mode === "mock" ? ["模拟演示，不代表真实内容核验。"] : []),
    ...(execution.validity === "needs_recheck"
      ? ["材料或要求已更新，需要重新检查。以下保留上次结果。"]
      : []),
    ...(execution.unexecutedCount ? [`还有 ${execution.unexecutedCount} 项未完成检查。`] : []),
    `检查文件：${execution.materialSnapshot.map((snapshot) => plain(task.materials.find((material) => material.id === snapshot.materialId && material.version === snapshot.version)?.originalFileName || "检查时的材料")).join("、") || "未上传材料"}`,
    "",
  ];
  const groups = [
    [
      "需要修改",
      execution.results.filter(
        (result) => result.verdict === "failed" && result.strength === "required",
      ),
    ],
    [
      "可改进项",
      execution.results.filter(
        (result) =>
          result.verdict === "failed" && ["recommended", "optional"].includes(result.strength),
      ),
    ],
    [
      "需要确认",
      execution.results.filter(
        (result) =>
          ["needs_confirmation", "unable_to_check"].includes(result.verdict) ||
          (result.verdict === "failed" && result.strength === "unknown"),
      ),
    ],
    ...(!onlyActionable
      ? [
          ["已通过", execution.results.filter((result) => result.verdict === "passed")],
          ["不适用", execution.results.filter((result) => result.verdict === "not_applicable")],
        ]
      : []),
  ] as Array<[string, ReviewExecution["results"]]>;
  for (const [title, results] of groups) {
    if (!results.length) continue;
    lines.push(`## ${title}`, "");
    for (const result of results) {
      lines.push(
        `### ${plain(result.requirement)}`,
        `${verdictLabels[result.verdict]}${result.strength === "recommended" ? " · 建议项" : result.strength === "optional" ? " · 可选项" : ""}：${plain(result.reason)}`,
      );
      if (result.recommendation) lines.push(`下一步：${plain(result.recommendation)}`);
      lines.push(
        `要求依据：${plain(result.source.displayName || "检查要求")} · ${plain(result.source.quotedText)}`,
      );
      for (const evidence of result.evidence) {
        const file = task.materials.find(
          (material) =>
            material.id === evidence.materialId && material.version === evidence.materialVersion,
        );
        lines.push(
          `材料依据：${plain(file?.originalFileName || "检查时的材料")} · ${plain(evidence.location)} · ${plain(evidence.quotedText)}`,
        );
      }
      if (result.coverage && !result.coverage.isComplete)
        lines.push("部分内容未能完整检查，请人工核对。");
      const note = execution.humanResolutions?.find((item) => item.ruleId === result.ruleId);
      if (note)
        lines.push(
          `人工备注：${{ confirmed: "认为符合", rejected: "认为不符合", deferred: "暂不确认" }[note.decision]} · ${plain(note.note)}（不改变检查结论）`,
        );
      lines.push("");
    }
  }
  const consistency = (execution.metadata?.materialConsistency || []).filter(
    (check) => check.verdict !== "passed",
  );
  if (consistency.length) {
    lines.push("## 材料信息需要核对", "");
    for (const check of consistency) {
      lines.push(
        `### ${plain(check.field)} · ${verdictLabels[check.verdict]}`,
        plain(check.reason),
        plain(check.recommendation),
      );
      for (const evidence of check.evidence)
        lines.push(`依据：${plain(evidence.location)} · ${plain(evidence.quotedText)}`);
      lines.push("");
    }
  }
  if (onlyActionable && !summary.failed && !summary.pending)
    lines.push("本次没有明确的必须项失败或待确认事项。", "");
  if (!execution.results.length) lines.push("尚无逐项检查结果，不能据此判断材料合格。", "");
  lines.push("结果仅供材料自查参考，最终以考试组织方审核为准。");
  return lines.join("\n");
}
