import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { applicableRule, executeReviewRule } from "../../src/lib/review-checks";
import { normalizeRules } from "../../src/lib/rule-normalization";
import { findRuleConflicts } from "../../src/lib/rule-conflicts";
import { classifyMaterial } from "../../src/lib/material-classification";
import { compareRepositoryRule } from "../../src/lib/repository-review";
import type { ReviewRule } from "../../src/domain/review-rule";
import type { ReviewMaterialSummary } from "../../src/domain/review";
function rule(description: string): ReviewRule {
  return {
    id: randomUUID(),
    code: "R-001",
    description,
    target: "全部材料",
    strength: "required",
    applicabilityScope: "unknown",
    applicabilityCondition: "",
    parameters: [],
    materialIds: [],
    checkability: "deterministic",
    generationMethod: "manual",
    uncertainty: "",
    source: {
      sourceId: randomUUID(),
      sourceVersion: 1,
      paragraphIndex: 0,
      quotedText: description,
      startOffset: 0,
      endOffset: description.length,
    },
  };
}
function material(text: string): ReviewMaterialSummary {
  return {
    id: randomUUID(),
    version: 1,
    originalFileName: "中性文件.txt",
    extension: "txt",
    parseStatus: "text_extracted",
    extractedText: text,
    segments: text.split("\n").map((text, index) => ({
      text,
      segmentIndex: index,
      location: `行${index + 1}`,
      startOffset: 0,
      endOffset: text.length,
    })),
  } as ReviewMaterialSummary;
}
test("复杂条件与未知参与范围不被单一阶段误判 R06 Q01", () => {
  const current = rule("必须提交证明");
  current.applicabilityScope = "team";
  expect(
    applicableRule(current, {
      collaborationScope: "unknown",
      projectStage: "决赛",
      projectType: "",
    }),
  ).toBeUndefined();
  current.applicabilityScope = "unknown";
  current.applicabilityCondition = "如进入决赛且使用外部数据";
  const background = { collaborationScope: "team" as const, projectStage: "决赛", projectType: "" };
  expect(applicableRule(current, background)).toBeUndefined();
  expect(
    applicableRule(current, {
      ...background,
      conditionAnswers: [
        { condition: current.applicabilityCondition, applies: false, note: "未使用外部数据" },
      ],
    }),
  ).toBe(false);
});
test("等价单位保留双方来源，固定名称空格不被错误合并 R10", () => {
  const a = rule("文件大小不超过1 KB"),
    b = rule("文件大小最多1000字节");
  const merged = normalizeRules([a, b]);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.additionalSources?.[0]?.sourceId).toBe(b.source.sourceId);
  expect(
    normalizeRules([rule("文件必须命名为“A B.txt”"), rule("文件必须命名为“AB.txt”")]),
  ).toHaveLength(2);
});
test("任意材料目标的排他格式冲突与主观能力 R11 R12", () => {
  const a = { ...rule("只能采用 PDF 格式"), target: "专业授权记录" },
    b = { ...rule("只能采用 DOCX 格式"), target: "专业授权记录" };
  expect(findRuleConflicts([a, b])).toHaveLength(1);
  expect(
    findRuleConflicts([
      { ...a, applicabilityScope: "individual" },
      { ...b, applicabilityScope: "team" },
    ]),
  ).toHaveLength(0);
  expect(normalizeRules([rule("作品应具有美观度和创新性")])[0]?.checkability).toBe("assisted");
});
test("通用内容分类、显式绑定存在性与字段双证据 M05 C01 C08", () => {
  const first = material("文档类型：授权证明\n自定义单位 | 甲单位"),
    second = material("自定义单位：乙单位");
  expect(classifyMaterial(first.segments)?.label).toBe("授权证明");
  const presence = { ...rule("必须提交授权证明"), target: "授权证明", materialIds: [first.id] };
  const background = { collaborationScope: "unknown" as const, projectStage: "", projectType: "" };
  expect(executeReviewRule(presence, [first], background).verdict).toBe("passed");
  const check = executeReviewRule(rule("字段“自定义单位”必须一致"), [first, second], background);
  expect(check.verdict).toBe("failed");
  expect(new Set(check.evidence.map((item) => item.materialId)).size).toBe(2);
  expect(check.evidence.every((item) => item.segmentIndex !== undefined)).toBe(true);
});
test("仓库存在性区分已读、明确404与网络失败 C17", () => {
  const repository = material("{}\n# Readme内容\n依赖清单\n网络失败");
  repository.parserName = "public-link";
  repository.segments[0]!.text = JSON.stringify({ repository: true, state: "accessible" });
  repository.segments[1]!.location = "仓库文件 Readme.md · blob abcdef · https://example.com";
  repository.segments[2]!.location = "仓库文件 package.json · blob abcdef · https://example.com";
  repository.segments[3]!.location = "仓库文件 .env.example · 未读取";
  expect(compareRepositoryRule("仓库必须提供README与依赖清单", [repository])?.verdict).toBe(
    "passed",
  );
  expect(compareRepositoryRule("仓库必须提供配置模板", [repository])?.verdict).toBe(
    "needs_confirmation",
  );
  repository.segments[3]!.location = "仓库文件 .env.example · HTTP 404";
  expect(compareRepositoryRule("仓库必须提供配置模板", [repository])?.verdict).toBe("failed");
  expect(compareRepositoryRule("README必须包含完整运行步骤", [repository])).toBeUndefined();
});
