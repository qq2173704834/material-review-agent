import test from "node:test";
import assert from "node:assert/strict";
import { countdownLabel, resolvedGoalNotice } from "../../src/lib/goal-schedule.ts";
import {
  prepProgress,
  learningDays,
  learningSummary,
  comparableScores,
} from "../../src/lib/preparation.ts";
import { safeBrowseReturn } from "../../src/lib/browse-return.ts";
test("北京时间跨日、月末、小时截止和未知日期", () => {
  assert.equal(countdownLabel("2027-01-01", Date.parse("2026-12-31T16:00:00Z")), "今天");
  assert.equal(countdownLabel("2027-01-01", Date.parse("2026-12-31T15:59:00Z")), "还有1天");
  assert.equal(
    countdownLabel("2027-01-01T10:00:00+08:00", Date.parse("2027-01-01T09:01:00+08:00")),
    "还有1小时",
  );
  assert.equal(countdownLabel("预计2027-01", Date.now()), "时间待公布");
});
test("场次与地区不得猜测、合并四六级匹配、歧义不选", () => {
  const goal = { category: "cet6", region: "北京", edition: "合成2027", noticeId: undefined };
  const notice = {
    id: "a",
    status: "published",
    content: { category: "cet4", title: "合成四、六级", region: "全国", edition: "合成2027" },
  };
  assert.equal(resolvedGoalNotice(goal, [notice])?.id, "a");
  assert.equal(resolvedGoalNotice({ ...goal, edition: "待确认考期" }, [notice]), undefined);
  assert.equal(resolvedGoalNotice(goal, [notice, { ...notice, id: "b" }]), undefined);
  assert.equal(
    resolvedGoalNotice(goal, [{ ...notice, content: { ...notice.content, region: "天津" } }]),
    undefined,
  );
  assert.equal(
    resolvedGoalNotice({ ...goal, noticeId: "a" }, [notice, { ...notice, id: "b" }])?.id,
    "a",
  );
});
test("统计只计实际完成和显式时长、撤销后重算", () => {
  const tasks = [
    { doneOn: "2026-11-15", minutes: 100, actualMinutes: null },
    { doneOn: "2026-11-15", minutes: 45, actualMinutes: 20 },
    { doneOn: "", minutes: 90, actualMinutes: 90 },
  ];
  assert.deepEqual(learningDays(tasks), { "2026-11-15": { tasks: 2, minutes: 20, recorded: 1 } });
  assert.deepEqual(prepProgress(tasks), { total: 3, completed: 2, percent: 67 });
  assert.equal(prepProgress([]).percent, 0);
  assert.deepEqual(learningDays(tasks.map((t) => ({ ...t, doneOn: "" }))), {});
});
test("不同体系、满分、维度不可比较；安全返回限制本站资源路径", () => {
  const a = { system: "A", scores: [{ dimension: "阅读", score: 8, maximum: 10 }] };
  assert.equal(
    comparableScores(a, { ...a, scores: [{ dimension: "阅读", score: 9, maximum: 10 }] }),
    true,
  );
  assert.equal(comparableScores(a, { ...a, system: "B" }), false);
  assert.equal(
    comparableScores(a, { ...a, scores: [{ dimension: "阅读", score: 8, maximum: 20 }] }),
    false,
  );
  assert.equal(safeBrowseReturn("//evil.test", "/exams"), "/exams");
  assert.equal(safeBrowseReturn("/learn?goal=x&page=2", "/exams"), "/learn?goal=x&page=2");
});

test("跨年学习周期不把缺少实际时长写成零，重开和删除记录重新聚合", () => {
  const tasks = [
    { doneOn: "2026-12-31", actualMinutes: null },
    { doneOn: "2027-01-01", actualMinutes: 0 },
    { doneOn: "2027-01-02", actualMinutes: 25 },
  ];
  assert.deepEqual(learningSummary(tasks, "2026-12-25", "2026-12-31"), {
    tasks: 1,
    minutes: null,
    days: 1,
  });
  assert.deepEqual(learningSummary(tasks, "2027-01-01", "2027-01-01"), {
    tasks: 1,
    minutes: 0,
    days: 1,
  });
  assert.deepEqual(learningSummary(tasks, "2027-01-01", "2027-01-07"), {
    tasks: 2,
    minutes: 25,
    days: 2,
  });
  assert.deepEqual(
    learningSummary(
      tasks.filter((task) => task.doneOn !== "2027-01-02"),
      "2027-01-01",
      "2027-01-07",
    ),
    { tasks: 1, minutes: 0, days: 1 },
  );
});
