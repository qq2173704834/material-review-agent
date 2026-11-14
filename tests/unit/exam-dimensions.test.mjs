import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExamCategories } from "../../src/lib/exam-discovery.ts";
import { matchesExamDimensions } from "../../src/lib/exam-dimensions.ts";
import { catalogLifecycle } from "../../src/lib/catalog-lifecycle.ts";

test("多考试共同公告保留独立分类，专业考试和推免不误并入其他类别", () => {
  assert.deepEqual(
    classifyExamCategories("大学英语四六级与全国计算机等级考试报名", "education-local"),
    ["ncre", "cet4", "cet6"],
  );
  assert.deepEqual(classifyExamCategories("法语专业八级考试", "education-local"), [
    "french-specialty",
  ]);
  assert.deepEqual(classifyExamCategories("同等学力申请硕士研究生考试", "education-local"), [
    "equivalent-master",
  ]);
  assert.deepEqual(classifyExamCategories("推荐免试研究生安排", "education-local"), [
    "recommendation",
  ]);
  assert.deepEqual(classifyExamCategories("PETS-5全国外语水平考试", "education-local"), ["wsk"]);
});
test("等级科目语种形式组合匹配，未知维度不会当作已确认匹配", () => {
  const content = {
    levels: ["二级"],
    subjects: ["Python"],
    languages: ["英语"],
    examForms: ["机考"],
  };
  assert.equal(
    matchesExamDimensions(content, { level: "二级", subject: "ｐｙｔｈｏｎ", examForm: "机考" }),
    true,
  );
  assert.equal(matchesExamDimensions(content, { level: "一级" }), false);
  assert.equal(matchesExamDimensions({}, { examForm: "口试" }), false);
  assert.equal(matchesExamDimensions({}, {}), true);
});
const record = (overrides = {}, region = "全国") => ({
  id: "synthetic",
  version: 1,
  status: "published",
  content: {
    kind: "knowledge",
    category: "bec",
    region,
    disposition: "现行",
    catalogStatus: "暂停",
    catalogEffectiveAt: "2026-01-01",
    title: "合成官方状态依据",
    url: "https://example.edu.cn/",
    checkedAt: "2026-11-14",
    ...overrides,
  },
});
test("停办更名保留证据，未发布/未来/历史状态不覆盖当前目录", () => {
  const day = "2026-11-14";
  assert.equal(catalogLifecycle([record()], "bec", "全国", day).blocked, true);
  assert.equal(
    catalogLifecycle([record({ catalogEffectiveAt: "2027-01-01" })], "bec", "全国", day).evidence
      .length,
    0,
  );
  assert.equal(
    catalogLifecycle([{ ...record(), status: "draft" }], "bec", "全国", day).evidence.length,
    0,
  );
  assert.equal(
    catalogLifecycle([record({ disposition: "历史" })], "bec", "全国", day).evidence.length,
    0,
  );
  assert.equal(
    catalogLifecycle(
      [record({ catalogStatus: "更名", renamedTo: "合成新名称" })],
      "bec",
      "全国",
      day,
    ).label,
    "已更名：合成新名称",
  );
});
test("地区状态不扩大成全国停办，同范围冲突保留双方并阻止肯定报名状态", () => {
  assert.equal(catalogLifecycle([record({}, "上海")], "bec", "北京", "2026-11-14").blocked, false);
  const status = catalogLifecycle(
    [record(), { ...record({ catalogStatus: "举办" }), id: "other" }],
    "bec",
    "全国",
    "2026-11-14",
  );
  assert.equal(status.blocked, true);
  assert.equal(status.evidence.length, 2);
  assert.match(status.label, /冲突/);
});
