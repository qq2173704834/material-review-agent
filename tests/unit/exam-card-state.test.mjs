import { test } from "node:test";
import assert from "node:assert/strict";
import { examCardState } from "../../src/lib/exam-card-state.ts";
const now = Date.parse("2026-11-14T10:00:00+08:00");
const content = (timeline, disposition = "正常") => ({ timeline, disposition });
test("完整报名时段使用绿色，端点后不再可报名", () => {
  const timeline = [
    { label: "报名开始", value: "2026-11-14T09:00:00+08:00" },
    { label: "报名截止", value: "2026-11-14T11:00:00+08:00" },
  ];
  assert.equal(examCardState(content(timeline), now).tone, "green");
  assert.equal(examCardState(content(timeline), now + 7200000).kind, "closed");
});
test("日期范围保留黄色时刻待确认，截止日含当天", () => {
  const result = examCardState(
    content([
      { label: "报名开始", value: "2026-11-01" },
      { label: "报名截止", value: "2026-11-14" },
    ]),
    now,
  );
  assert.equal(result.tone, "amber");
  assert.equal(result.current, true);
  assert.match(result.label, /待确认/);
});
test("北京时间考试日显示今日考试，未推断具体场次", () => {
  const result = examCardState(content([{ label: "笔试", value: "2026-11-14" }]), now);
  assert.equal(result.kind, "exam");
  assert.equal(result.tone, "blue");
  assert.equal(result.current, true);
});
test("取消、未知及仅开始日期不显示绿色", () => {
  assert.equal(examCardState(content([], "取消"), now).current, false);
  assert.equal(examCardState(content([]), now).kind, "unknown");
  assert.notEqual(
    examCardState(content([{ label: "报名开始", value: "2026-11-01" }]), now).tone,
    "green",
  );
});
test("未来报名和历史考试不混入当前考试", () => {
  assert.equal(
    examCardState(content([{ label: "报名开始", value: "2026-11-20" }]), now).current,
    false,
  );
  assert.equal(
    examCardState(content([{ label: "笔试", value: "2026-11-13" }]), now).current,
    false,
  );
});
