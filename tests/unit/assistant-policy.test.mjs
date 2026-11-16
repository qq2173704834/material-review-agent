import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assistantPolicy,
  lacksDatedExamNotice,
  isLearningQuestion,
  isExamPolicyQuestion,
} from "../../src/lib/assistant-policy.ts";
test("助手限额可配置并有边界，停用与模型模式分离", () => {
  assert.deepEqual(assistantPolicy({}), { enabled: true, hourlyLimit: 20 });
  assert.deepEqual(assistantPolicy({ ASSISTANT_ENABLED: "off", ASSISTANT_HOURLY_LIMIT: "5" }), {
    enabled: false,
    hourlyLimit: 5,
  });
  for (const value of ["0", "201", "NaN", "1.5", ""])
    assert.equal(assistantPolicy({ ASSISTANT_HOURLY_LIMIT: value }).hourlyLimit, 20);
  for (const value of ["1", "200"])
    assert.equal(assistantPolicy({ ASSISTANT_HOURLY_LIMIT: value }).hourlyLimit, Number(value));
});

test("当期日期问题无当期公告时拒绝模型补猜，介绍和旧考期不能替代", () => {
  const notice = { url: "/exams/synthetic", scope: "全国 · 2027年 · 合成考试", historical: false };
  for (const question of [
    "2027年DELE从哪一天开始报名？",
    "2027年考试时间是什么？",
    "2027年什么时候缴费？",
  ]) {
    assert.equal(lacksDatedExamNotice(question, false, []), true);
    assert.equal(lacksDatedExamNotice(question, false, [notice]), false);
    assert.equal(
      lacksDatedExamNotice(question, false, [{ ...notice, url: "/learn/synthetic" }]),
      true,
    );
    assert.equal(
      lacksDatedExamNotice(question, false, [{ ...notice, scope: "全国 · 2026年 · 合成考试" }]),
      true,
    );
    assert.equal(lacksDatedExamNotice(question, false, [{ ...notice, historical: true }]), true);
  }
  assert.equal(lacksDatedExamNotice("2027年请制定学习时间计划", true, []), false);
  assert.equal(lacksDatedExamNotice("2026年基金考试成绩有效期是多少？", false, []), false);
  assert.equal(lacksDatedExamNotice("北京教资学历和报名条件是什么？", false, []), false);
});

test("BUG070 学习计划自动识别，混合政策问题仍需核验", () => {
  for (const question of [
    "我是在校大学生，准备四级，每天30分钟，请给一周入门安排",
    "本周怎样复习四级听力",
    "请讲解Python字典",
  ])
    assert.equal(isLearningQuestion(question), true, question);
  for (const question of [
    "2029年四级报名截止日期和复习计划",
    "请问考试时间，再给我备考建议",
    "我能不能报名四级，应怎样复习",
  ])
    assert.equal(isLearningQuestion(question), false, question);
  assert.equal(isExamPolicyQuestion("2029年四级报名截止日期和复习计划"), true);
});
