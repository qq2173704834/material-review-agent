import { compareExecutions } from "@/lib/review-history";

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

export function createReviewReport(
  task: ReviewTaskDetails,
  execution: ReviewExecution,
  ruleSet: ReviewRuleSet,
  previous?: ReviewExecution,
): string {
  const lines = [
    `# ${plain(task.name)} · 材料预审报告`,
    "",
    `- 导出时间：${new Date().toISOString()}`,
    `- 任务 ID：${task.id}`,
    `- 执行 ID：${execution.id}`,
    `- 通知版本：v${execution.sourceVersion}`,
    `- 规则集：${execution.ruleSetId}`,
    `- 规则提取：${ruleSet.mode === "live" ? `真实模型 ${plain(ruleSet.provider)} / ${plain(ruleSet.model)}` : "本地模拟"}`,
    `- 检查模式：${execution.metadata?.mode === "live" ? `真实模型与确定性工具（${plain(execution.metadata.provider)} / ${plain(execution.metadata.model)}）` : execution.metadata?.mode === "mock" ? "本地模拟流程与确定性工具" : "历史记录未注明"}`,
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
    lines.push(
      `### ${result.ruleCode} · ${verdictLabels[result.verdict]}`,
      "",
      `- 要求：${plain(result.requirement)}`,
      `- 强度：${{ required: "必须", recommended: "建议", optional: "可选", unknown: "待确认" }[result.strength]}`,
      `- 检查方式：${result.method === "model" ? "真实模型辅助审查" : result.method === "unavailable" ? "未能检查" : "确定性工具/适用性判断"}`,
      `- 原因：${plain(result.reason)}`,
      `- 建议：${plain(result.recommendation) || "无"}`,
      `- 要求依据：通知 v${execution.sourceVersion}，段落 ${result.source.paragraphIndex + 1}，${plain(result.source.quotedText)}`,
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
    lines.push("");
  }
  const calls = [...ruleSet.modelCalls, ...(execution.metadata?.modelCalls ?? [])];
  lines.push(
    "## 模型调用与限制",
    "",
    `- 已记录模型步骤：${calls.length}；HTTP 请求：${calls.reduce((total, call) => total + call.requestCount, 0)}（包含有限重试）。`,
    `- 已知输入 token：${calls.reduce((total, call) => total + (call.inputTokens ?? 0), 0)}；已知输出 token：${calls.reduce((total, call) => total + (call.outputTokens ?? 0), 0)}。`,
    `- 未提供完整 token 用量的步骤：${calls.filter((call) => call.inputTokens === null || call.outputTokens === null).length}。费用和剩余额度以服务商账单为准；本报告没有估算价格。`,
    ...calls.map(
      (call) =>
        `- ${call.operation} · ${plain(call.provider)}/${plain(call.model)} · ${call.startedAt}—${call.completedAt} · ${call.status}${call.errorCode ? `（${plain(call.errorCode)}）` : ""}`,
    ),
    "- 未实施图像 OCR、签章真实性验证和官方提交。有限检索未命中不能证明全文不存在。",
    ...(execution.metadata?.limitations ?? []).map((limitation) => `- ${plain(limitation)}`),
    "",
  );
  return lines.join("\n");
}
