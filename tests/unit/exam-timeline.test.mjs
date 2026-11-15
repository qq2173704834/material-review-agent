import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  examTimeline,
  reviewedExamDates,
  unrecordedExamDates,
} from "../../src/lib/exam-timeline.ts";
import { examCardState } from "../../src/lib/exam-card-state.ts";
const records = ["official-notices-2026-11-14", "official-notices-expansion-2026-11-14"].flatMap(
  (name) => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), "utf8")),
);
const content = (category) => records.find((r) => r.content.category === category).content;

test("全部13条公开公告核对：已核验补充均有可定位来源，不把月份估计或地区安排填成确切日期", () => {
  assert.equal(records.length, 13);
  for (const { content: value } of records) {
    const reference = reviewedExamDates(value);
    if (reference)
      for (const point of reference.timeline) {
        assert.ok(reference.sourceText.includes(point.quote));
        assert.equal(new URL(reference.sourceUrl).protocol, "https:");
        assert.ok(Number.isFinite(Date.parse(point.value)));
        if (point.endValue) assert.ok(point.endValue >= point.value);
      }
    assert.deepEqual(unrecordedExamDates(value), []);
  }
  assert.equal(
    examTimeline(content("cpa")).some((p) => p.label === "成绩"),
    false,
  );
  assert.equal(
    examTimeline(content("cet4")).some((p) => p.label === "报名截止"),
    false,
  );
});

test("正文已有日期和表格日期补齐，成绩即日起取真实发布日，原正文和时间字段不被改写", () => {
  for (const [category, label, date] of [
    ["ccpt", "考试", "2026-11-21"],
    ["software", "考试", "2026-10-24"],
    ["cpa", "考试", "2026-08-29"],
    ["ncre", "成绩", "2026-11-10"],
    ["pets", "成绩", "2026-11-11"],
    ["nit", "成绩", "2026-07-23"],
  ]) {
    const value = content(category),
      before = JSON.stringify(value);
    assert.equal(examTimeline(value).find((p) => p.label === label).value, date);
    assert.equal(JSON.stringify(value), before);
  }
});

test("补充仅适用于严格匹配的公开快照，别的考期、地区、正文或已编辑日期不能覆盖", () => {
  const value = content("cpa");
  for (const changed of [
    { year: 2027 },
    { region: "上海" },
    { edition: "2027年" },
    { text: value.text + "已更正" },
    { title: "新通知" },
  ])
    assert.equal(reviewedExamDates({ ...value, ...changed }), undefined);
  const edited = examTimeline({
    ...value,
    timeline: [{ label: "考试", value: "2026-09-01", quote: "新的日期" }],
  });
  assert.equal(edited.find((p) => p.label === "考试").value, "2026-09-01");
  assert.equal(edited.find((p) => p.label === "考试").endValue, undefined);
  assert.equal(
    reviewedExamDates({ ...value, timeline: [{ label: "考试", value: "2026-09-01" }] }),
    undefined,
  );
});

test("多日考试最后一天仍在进行，最后一天后才结束；取消和延期不沿用正常状态", () => {
  const value = content("cpa");
  assert.equal(examCardState(value, Date.parse("2026-08-30T12:00:00+08:00")).label, "考试进行中");
  assert.equal(examCardState(value, Date.parse("2026-08-31T00:00:00+08:00")).label, "考试已结束");
  assert.equal(examCardState(value, Date.parse("2026-11-15T12:00:00+08:00")).kind, "closed");
  for (const disposition of ["取消", "延期"])
    assert.equal(examCardState({ ...value, disposition }).label, disposition);
});

test("成绩、证书、考试提醒没有日程时分别表达，缺字段不声称官方尚未公布", () => {
  assert.equal(
    examCardState({ timeline: [], disposition: "正常", stage: "成绩" }).label,
    "成绩查询",
  );
  assert.equal(
    examCardState({ timeline: [], disposition: "正常", stage: "其他", title: "证书领取通知" })
      .label,
    "证书通知",
  );
  assert.equal(
    examCardState({ timeline: [], disposition: "正常", stage: "考试" }).label,
    "考试通知",
  );
  assert.equal(
    examCardState({ timeline: [], disposition: "正常", stage: "招考报名" }).label,
    "日程未收录",
  );
});

test("发布前检查明确考试日期漏录，不从发布日期、相对日期或不完整语句猜考试日期", () => {
  const value = { timeline: [], year: 2026, text: "本次考试将于12月12日举行。" };
  assert.deepEqual(unrecordedExamDates(value), ["2026-12-12"]);
  assert.deepEqual(
    unrecordedExamDates({ ...value, timeline: [{ label: "笔试", value: "2026-12-12" }] }),
    [],
  );
  for (const text of [
    "发布日期2026年11月15日，考试时间另行通知。",
    "考试将于下月举行。",
    "考试将于2月30日举行。",
    "面试报名工作将于11月6日开始。",
    "笔试成绩将于11月6日公布。",
  ])
    assert.deepEqual(unrecordedExamDates({ ...value, text }), []);
});
