import { test, expect } from "@playwright/test";
import { retrieveEvidence } from "../../src/lib/evidence-retrieval";
import type { ReviewMaterialSummary } from "../../src/domain/review";
import type { ReviewRule } from "../../src/domain/review-rule";

test("长片段尾部证据可被检索且未读范围不冒充全文 ENG-008", () => {
  const text = "无关填充段落。".repeat(5000) + "测试样本量：100，测试结果完整记录。";
  const material = {
    id: "sample",
    parseStatus: "text_extracted",
    segments: [
      { segmentIndex: 4, text, location: "第 5 页", startOffset: 0, endOffset: text.length },
    ],
  } as ReviewMaterialSummary;
  const rule = { target: "项目说明", description: "必须给出测试样本量及测试结果" } as ReviewRule;
  const result = retrieveEvidence(rule, [material]);
  expect(result.snippets.some((snippet) => snippet.text.includes("测试样本量：100"))).toBe(true);
  expect(
    result.snippets.every((snippet) => snippet.segmentIndex === 4 && text.includes(snippet.text)),
  ).toBe(true);
  expect(
    result.snippets.reduce((sum, snippet) => sum + snippet.text.length, 0),
  ).toBeLessThanOrEqual(24000);
  expect(result.coverage.isComplete).toBe(false);
});

test("首轮未选中证据可用参数与关联词扩展查询 A10", () => {
  const material = {
    id: "long-material",
    parseStatus: "text_extracted",
    segments: Array.from({ length: 30 }, (_, index) => ({
      segmentIndex: index,
      text: index === 29 ? "费用明细：材料费100元，服务费200元。" : "预算说明".repeat(500),
      location: `段落${index}`,
      startOffset: index * 2000,
      endOffset: (index + 1) * 2000,
    })),
  } as ReviewMaterialSummary;
  const rule = {
    target: "说明",
    description: "预算必须提供详细说明",
    parameters: ["费用明细"],
  } as ReviewRule;
  const result = retrieveEvidence(rule, [material]);
  expect(
    result.snippets.some(
      (snippet) => snippet.segmentIndex === 29 && snippet.text.includes("费用明细"),
    ),
  ).toBe(true);
  expect(result.coverage.isComplete).toBe(false);
  expect(
    result.snippets.reduce((sum, snippet) => sum + snippet.text.length, 0),
  ).toBeLessThanOrEqual(24000);
});
