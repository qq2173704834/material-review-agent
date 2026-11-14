import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExamTitle, matchesExamSearch, examProfile } from "../../src/lib/exam-discovery.ts";
import { beijingDay, isUpcoming, homepageOptions } from "../../src/lib/portal-feed.ts";
import { EXAM_CATEGORIES } from "../../src/domain/exam-catalog.ts";
for (const [title, expected] of [
  ["2027全国计算机四级报名通知", "ncre"],
  ["英语专业四级报名", "tem4"],
  ["法语专业八级考试", "french-specialty"],
  ["CET-6成绩查询", "cet6"],
  ["大学英语四、六级笔试报名通知", "cet4"],
  ["推荐免试研究生接收办法", "recommendation"],
  ["同等学力申请硕士学位考试", "equivalent-master"],
  ["PETS-5考试通知", "wsk"],
  ["全国计算机应用水平考试NIT", "nit"],
  ["教师资格认定公告", "teacher"],
  ["2033年上海注会报名条件", "cpa"],
  ["教资报名条件", "teacher"],
])
  test(`EXP 分类：${title}`, () =>
    assert.equal(classifyExamTitle(title, "education-local"), expected));
test("EXP 目录保持68类唯一候选，别名可检索且专业资格提示年限", () => {
  assert.equal(EXAM_CATEGORIES.length, 68);
  assert.equal(new Set(EXAM_CATEGORIES.map((item) => item[0])).size, 68);
  assert.ok(matchesExamSearch("tem4", "TEM-4"));
  assert.ok(matchesExamSearch("ncre", "计算机二级"));
  assert.equal(matchesExamSearch("cet4", "计算机四级"), false);
  assert.match(examProfile("construction-first").audience, /年限/);
});
test("PORT 北京日界与日期精度，过去节点不当即将截止", () => {
  const now = Date.parse("2026-11-13T16:01:00Z");
  assert.equal(beijingDay(now), "2026-11-14");
  assert.ok(isUpcoming("2026-11-14", now));
  assert.equal(isUpcoming("2026-11-13", now), false);
  assert.equal(isUpcoming("", now), false);
});
test("首页展示范围与数量有界且无效输入回退", () => {
  assert.deepEqual(homepageOptions({}), { days: 30, size: 12 });
  assert.deepEqual(homepageOptions({ days: "90", size: "24" }), { days: 90, size: 24 });
  assert.deepEqual(homepageOptions({ days: "999999", size: "-1" }), { days: 30, size: 12 });
});
