import test from "node:test";
import assert from "node:assert/strict";
import {
  campusScheduleNodes,
  scheduleDate,
  scheduleGroup,
  scheduleOverdue,
  scheduleTimestamp,
  scheduleCountdown,
  formatScheduleTime,
  sortSchedule,
} from "../../src/lib/schedule.ts";
import { safeBrowseReturn } from "../../src/lib/browse-return.ts";

test("日程分类区分考试、申请、报告和其他，不把未知标签推断为考试", () => {
  assert.equal(scheduleGroup("报名截止"), "报名与申请");
  assert.equal(scheduleGroup("奖学金申请"), "报名与申请");
  assert.equal(scheduleGroup("资格复审"), "报名与申请");
  assert.equal(scheduleGroup("笔试"), "考试安排");
  assert.equal(scheduleGroup("课程报告"), "作业与报告");
  assert.equal(scheduleGroup("新通知"), "活动与其他");
});
test("日期精度和时区：仅日期到次日才逾期，明确时刻按北京时间，未知无日期", () => {
  assert.equal(scheduleTimestamp("2027-01-06T09:00"), Date.parse("2027-01-06T01:00:00Z"));
  assert.equal(scheduleDate("2027-01-05T17:00:00Z"), "2027-01-06");
  assert.equal(scheduleDate("另行通知"), "");
  assert.equal(scheduleOverdue("2027-01-06", Date.parse("2027-01-06T23:59:00+08:00")), false);
  assert.equal(scheduleOverdue("2027-01-06", Date.parse("2027-01-07T00:00:00+08:00")), true);
  assert.equal(scheduleOverdue("2027-01-06T09:00", Date.parse("2027-01-06T09:00:00+08:00")), true);
  assert.equal(scheduleOverdue("", Date.now()), false);
  assert.equal(scheduleCountdown("2027-01-06", Date.parse("2027-01-06T12:00:00+08:00")), "今天");
  assert.equal(scheduleCountdown("2027-01-07", Date.parse("2027-01-06T12:00:00+08:00")), "还有1天");
  assert.equal(scheduleCountdown("", Date.now()), "时间待公布");
  assert.equal(formatScheduleTime("2027-01-06T01:00:00Z"), "2027-01-06 09:00");
});
test("私人日程复用原ID和完成状态，报告取截止时间；未知排在日期之后", () => {
  const events = [
    {
      id: "report",
      kind: "课程报告",
      title: "报告",
      start: "2027-01-01",
      end: "2027-01-06",
      done: true,
    },
    { id: "unknown", kind: "考试", title: "待定期末", start: "", end: "", done: false },
    {
      id: "exam",
      kind: "考试",
      title: "期末",
      start: "2027-01-03T09:00",
      end: "2027-01-03T11:00",
      done: false,
    },
  ];
  const nodes = sortSchedule(campusScheduleNodes(events));
  assert.deepEqual(
    nodes.map((item) => item.id),
    ["campus:exam", "campus:report", "campus:unknown"],
  );
  assert.equal(nodes[1].value, "2027-01-06");
  assert.equal(nodes[1].done, true);
  assert.equal(nodes[0].event, events[2]);
});
test("重组返回链接支持日程/记录/校园并保留参数，拒绝站外、反斜杠和控制字符", () => {
  for (const href of [
    "/me/schedule?group=考试安排#pending",
    "/campus?notice=abc#notice-abc",
    "/me/records?goal=x",
  ])
    assert.equal(decodeURI(safeBrowseReturn(href, "/learn")), href);
  for (const href of [
    "//evil.test/me/schedule",
    "https://evil.test",
    "/\\evil.test",
    "/admin/system",
    "/me/schedule\n",
  ])
    assert.equal(safeBrowseReturn(href, "/learn"), "/learn");
});
