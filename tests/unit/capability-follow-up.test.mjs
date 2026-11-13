import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareAlignedFields,
  fieldCandidates,
  normalizeFieldValue,
} from "../../src/lib/field-alignment.ts";
import { findRuleConflicts } from "../../src/lib/rule-conflicts.ts";
import { explicitRuleScope, compareRuleScopes } from "../../src/lib/conflict-scope.ts";
import { requestOrigin } from "../../src/lib/public-origin.ts";
import { ocrRegion } from "../../src/lib/ocr-regions.ts";
import { editDistance, evaluateOcr } from "../../scripts/lib/ocr-evaluation.mjs";
function material(id, text) {
  return {
    id,
    version: 1,
    originalFileName: id + ".txt",
    parseStatus: "text_extracted",
    extractedText: text,
    segments: [
      { segmentIndex: 0, text, location: "第1段", startOffset: 0, endOffset: text.length },
    ],
  };
}
const materials = [
  material("a", "申请人：张三\n导师：李四"),
  material("b", "负责人：张三\n指导教师：李四"),
];
const mapping = (materialId, sourceField, rawValue, subject = "申请人A") => ({
  materialId,
  materialVersion: 1,
  sourceField,
  rawValue,
  subject,
  canonicalField: "负责人",
  segmentIndex: 0,
  note: "按报名编号核对",
  confirmedBy: "tester",
  confirmedAt: "2026-11-14T00:00:00.000Z",
});
const mappings = [mapping("a", "申请人", "张三"), mapping("b", "负责人", "张三")];
test("CAP03 原文字段候选不自动合并角色", () => {
  assert.equal(fieldCandidates(materials).length, 4);
});
test("CAP03 人工别名按主体对齐并保留双版本证据", () => {
  const result = compareAlignedFields("负责人", materials, mappings);
  assert.equal(result.verdict, "passed");
  assert.equal(result.evidence.length, 2);
  assert.equal(result.evidence[0].materialVersion, 1);
});
test("CAP03 不把不同主体拼成同一人", () => {
  assert.equal(
    compareAlignedFields("负责人", materials, [mappings[0], { ...mappings[1], subject: "导师B" }])
      .verdict,
    "needs_confirmation",
  );
});
test("CAP03 多主体分别比较不做全局相等", () => {
  assert.equal(
    compareAlignedFields("负责人", materials, [
      ...mappings,
      mapping("a", "导师", "李四", "导师B"),
      mapping("b", "指导教师", "李四", "导师B"),
    ]).verdict,
    "passed",
  );
});
test("CAP03 材料换版令映射失效", () => {
  assert.equal(
    compareAlignedFields("负责人", [{ ...materials[0], version: 2 }, materials[1]], mappings)
      .verdict,
    "needs_confirmation",
  );
});
test("CAP03 缺项不能按另一份材料补齐", () => {
  assert.equal(
    compareAlignedFields("负责人", materials, [mappings[0]]).verdict,
    "needs_confirmation",
  );
});
test("CAP03 遮挡值相同也不能通过", () => {
  const files = [material("a", "姓名：张*"), material("b", "姓名：张*")];
  assert.equal(
    compareAlignedFields("负责人", files, [
      mapping("a", "姓名", "张*"),
      mapping("b", "姓名", "张*"),
    ]).verdict,
    "needs_confirmation",
  );
});
test("CAP03 不同原值提供双方冲突证据", () => {
  const files = [materials[0], material("b", "负责人：王五")];
  const result = compareAlignedFields("负责人", files, [
    mappings[0],
    mapping("b", "负责人", "王五"),
  ]);
  assert.equal(result.verdict, "failed");
  assert.equal(result.evidence.length, 2);
});
test("CAP03 日期规范化只接受有效公历日期", () => {
  assert.equal(normalizeFieldValue("2026年1月2日").value, "2026-01-02");
  assert.equal(normalizeFieldValue("2026/02/30").value, "2026/02/30");
  assert.equal(normalizeFieldValue(" e\u0301   A ").value, "é A");
});
test("CAP01 归一化区域不越过页面边界并保留候选", () => {
  const region = ocrRegion(
    { bbox: { x0: 10, y0: 20, x1: 200, y1: 300 }, inferredColumns: true },
    100,
    200,
    2,
    3,
  );
  assert.equal(region.box.width, 0.9);
  assert.equal(region.status, "candidate");
  assert.equal(region.role, "table");
  assert.equal(region.pageNumber, 2);
});
function rule(id, description, condition = "") {
  return {
    id,
    description,
    target: "申请书",
    applicabilityScope: "unknown",
    applicabilityCondition: condition,
    source: { sourceId: id, quotedText: condition + "；" + description },
  };
}
const minimum = rule("a", "申请书至少10页"),
  maximum = rule("b", "申请书最多5页");
test("CAP04 显式矛盾仍检出双引用", () => {
  const result = findRuleConflicts([minimum, maximum]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sources.length, 2);
});
test("CAP04 不同地区不误报", () => {
  assert.equal(
    findRuleConflicts([
      { ...minimum, applicabilityCondition: "地区：浙江" },
      { ...maximum, applicabilityCondition: "地区：江苏" },
    ]).length,
    0,
  );
});
test("CAP04 不同阶段不误报", () => {
  assert.equal(
    findRuleConflicts([
      { ...minimum, applicabilityCondition: "阶段：报名" },
      { ...maximum, applicabilityCondition: "阶段：录用" },
    ]).length,
    0,
  );
});
test("CAP04 例外关系只生成待核对候选", () => {
  assert.match(
    findRuleConflicts([minimum, rule("b", "除应届生外，申请书最多5页")])[0].message,
    /待核对/,
  );
});
test("CAP04 局部替代不按时间覆盖独立条款", () => {
  const result = findRuleConflicts([
    minimum,
    rule("b", "更正：申请书最多5页替代原第三条"),
    { ...maximum, id: "c", target: "其他材料" },
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].relatedRuleIds, ["a", "b"]);
});
test("CAP04 范围缺少信息保留未知，不推断全局", () => {
  assert.equal(compareRuleScopes(explicitRuleScope("地区：浙江；科目：英语"), {}), "unknown");
});
test("REL01 可信公开域名与HTTPS不信任转发头", () => {
  const request = new Request("http://internal/api", {
    headers: { host: "exams.example.test", "x-forwarded-proto": "http" },
  });
  assert.equal(requestOrigin(request, "https://exams.example.test"), "https://exams.example.test");
  assert.throws(() => requestOrigin(request, "http://exams.example.test"));
  assert.throws(() => requestOrigin(new Request("http://evil.test"), "https://exams.example.test"));
});
test("CAP02 CER计算替换、删除和插入的原始错误数", () => {
  assert.equal(editDistance("abc", "axcd"), 2);
  assert.equal(editDistance("e\u0301", "é"), 0);
});
test("CAP02 独立分类报告不把关键字段OCR分数当准确率", () => {
  const report = evaluateOcr({
    format: 1,
    labelOrigin: "合成单测",
    samples: [
      {
        id: "x",
        category: "handwritten",
        source: "合成",
        authorization: "测试",
        annotator: "测试者",
        elapsedMs: 10,
        regions: [
          { reference: "张三", prediction: "张" },
          { reference: "金额", prediction: "" },
        ],
        keyFields: [{ name: "姓名", reference: "张三", prediction: "张" }],
      },
    ],
  });
  assert.equal(report.groups.handwritten.characterErrors, 3);
  assert.equal(report.groups.handwritten.missedRegionRate, 0.5);
  assert.equal(report.groups.handwritten.keyFieldExactRate, 0);
  assert.match(report.qualityGate, /待独立样本/);
});
test("CAP02 缺少来源与标注人不接受质量报告", () => {
  assert.throws(() => evaluateOcr({ format: 1, samples: [{ id: "x" }] }));
});

import { validImageCorners, projectImagePoint } from "../../src/lib/perspective.ts";
import { relationWarnings } from "../../src/lib/relation-candidates.ts";
test("CAP02 透视四角映射与交叉拒绝", () => {
  const points = [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.2, y: 0.8 },
  ];
  assert.equal(validImageCorners(points), true);
  for (const [u, v, index] of [
    [0, 0, 0],
    [1, 0, 1],
    [1, 1, 2],
    [0, 1, 3],
  ]) {
    const result = projectImagePoint(points, u, v);
    assert.ok(Math.abs(result.x - points[index].x) < 1e-9);
    assert.ok(Math.abs(result.y - points[index].y) < 1e-9);
  }
  assert.equal(validImageCorners([points[0], points[2], points[1], points[3]]), false);
  assert.throws(() => projectImagePoint([{ x: 0, y: 0 }], 0, 0));
});
test("CAP04 模型关系候选需双方条款逐字引用", () => {
  const sources = [
      {
        id: "s",
        segments: [
          { paragraphIndex: 0, text: "条款A" },
          { paragraphIndex: 1, text: "条款B" },
        ],
      },
    ],
    rules = [
      { id: "a", source: { sourceId: "s", paragraphIndex: 0, quotedText: "条款A" } },
      { id: "b", source: { sourceId: "s", paragraphIndex: 1, quotedText: "条款B" } },
    ];
  const relation = {
    first: { sourceId: "s", paragraphIndex: 0, quotedText: "条款A" },
    second: { sourceId: "s", paragraphIndex: 1, quotedText: "条款B" },
    kind: "implicit_conflict",
    reason: "范围需人工确认",
  };
  assert.match(relationWarnings([relation], sources, rules)[0].message, /模型待核对/);
  assert.throws(
    () =>
      relationWarnings(
        [{ ...relation, second: { ...relation.second, quotedText: "伪造" } }],
        sources,
        rules,
      ),
    /引用不足/,
  );
  assert.throws(
    () => relationWarnings([{ ...relation, second: relation.first }], sources, rules),
    /不同条款/,
  );
});
