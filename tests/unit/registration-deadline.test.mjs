import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationDeadline } from "../../src/lib/registration-deadline.ts";
import { examCardState } from "../../src/lib/exam-card-state.ts";
const now = Date.parse("2026-11-14T10:00:00+08:00");
const content = (value, disposition = "正常") => ({
  disposition,
  timeline: [{ label: "报名截止", value }],
});
test("截止提示按北京时间计算天时分，最后一分钟不显示0分钟", () => {
  assert.match(
    registrationDeadline(content("2026-11-16T12:03:00+08:00"), now).label,
    /2天2小时3分钟/,
  );
  assert.equal(
    registrationDeadline(content("2026-11-14T10:00:01+08:00"), now).label,
    "距报名截止1分钟",
  );
  assert.equal(
    registrationDeadline(content("2026-11-14T10:00:00+08:00"), now).label,
    "已到报名截止时刻",
  );
  assert.equal(registrationDeadline(content("2026-11-14T09:59:59+08:00"), now).label, "报名已截止");
});
test("截止日期不补造23:59且跨北京时间午夜按日历计算", () => {
  const day = registrationDeadline(content("2026-11-14"), now);
  assert.match(day.label, /今日.*核对具体时刻/);
  assert.equal(day.urgent, false);
  assert.match(registrationDeadline(content("2026-11-16"), now).label, /还有2天/);
  assert.equal(registrationDeadline(content("2026-11-13"), now).label, "报名截止日期已过");
  assert.match(
    registrationDeadline(content("2026-11-15"), Date.parse("2026-11-14T16:01:00Z")).label,
    /今日/,
  );
});
test("截止未知、错误日期、取消延期不产生倒计时", () => {
  for (const value of ["", "2026-02-30", "2026-11-14T24:00:00+08:00", "invalid"])
    assert.equal(registrationDeadline(content(value), now).label, "报名截止时间待确认");
  for (const state of ["延期", "取消", "待核实"]) {
    const r = registrationDeadline(content("2026-11-15", state), now);
    assert.match(r.label, new RegExp(state));
    assert.equal(r.date, "");
  }
});
test("临近24小时才突出截止；成绩公告不会显示报名时间未知", () => {
  assert.equal(registrationDeadline(content("2026-11-15T10:00:00+08:00"), now).urgent, true);
  assert.equal(registrationDeadline(content("2026-11-16T10:00:00+08:00"), now).urgent, false);
  assert.equal(examCardState({ ...content(""), stage: "成绩" }, now).label, "成绩查询");
  assert.equal(
    examCardState(
      { disposition: "正常", stage: "成绩", timeline: [{ label: "成绩", value: "2026-11-15" }] },
      now,
    ).label,
    "待公布成绩",
  );
});
