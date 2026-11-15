import test from "node:test";
import assert from "node:assert/strict";
import {
  campusQuestionEvents,
  campusImportPreview,
  campusReminders,
  campusReminderKey,
  campusConflicts,
} from "../../src/lib/campus.ts";
import { campusArticle, campusPublicationDate } from "../../src/lib/campus-article.ts";
import { materialConsistency } from "../../src/lib/material-consistency.ts";

test("校园导入：无参考日期不猜相对时间，跨年下周按原消息日期解释", () => {
  assert.equal(campusImportPreview("数据结构作业下周五提交")[0].end, "");
  assert.equal(campusImportPreview("四六级报名截止2027年1月6日")[0].kind, "报名");
  assert.equal(
    campusImportPreview("课程：高等数学，地点：A101，期末考试2027年1月6日09:30")[0].location,
    "A101",
  );
  assert.equal(
    campusImportPreview("数据结构作业下周五晚八点前交", "2026-12-31")[0].end,
    "2027-01-08T20:00",
  );
  assert.equal(campusImportPreview("数据结构作业下周天提交", "2026-12-31")[0].end, "2027-01-10");
  assert.equal(campusImportPreview("数据结构作业下周五提交", "2026-12-31")[0].end, "2027-01-08");
  assert.equal(campusImportPreview("期末考试2027年1月6日09:30")[0].start, "2027-01-06T09:30");
  assert.equal(campusImportPreview("作业1月6日提交")[0].end, "");
  assert.equal(campusImportPreview("报告2027年1月6日提交")[0].end, "2027-01-06");
});
test("日期精度：不补23:59，未知不提醒，完成/改期使旧提醒失效", () => {
  const event = {
    id: "a",
    kind: "作业",
    start: "",
    end: "2027-01-06",
    reminderHours: 24,
    done: false,
  };
  const now = Date.parse("2027-01-05T12:00:00+08:00");
  assert.equal(campusReminders([event], now).length, 1);
  for (const changed of [
    { ...event, done: true },
    { ...event, end: "" },
    { ...event, reminderHours: 2 },
    { ...event, end: "2027-01-20" },
  ])
    assert.equal(campusReminders([changed], now).length, 0);
  assert.notEqual(campusReminderKey(event), campusReminderKey({ ...event, end: "2027-01-07" }));
  assert.equal(
    campusReminders(
      [{ ...event, end: "2027-01-06T14:00", reminderHours: 2 }],
      Date.parse("2027-01-06T13:00:00+08:00"),
    ).length,
    1,
  );
});
test("考试冲突只比较实际时段；同日日期或相邻时段不编造冲突", () => {
  const a = {
    id: "a",
    kind: "考试",
    start: "2027-01-06T09:00",
    end: "2027-01-06T11:00",
    done: false,
  };
  assert.deepEqual(campusConflicts([a, { ...a, id: "b", start: "2027-01-06T10:00" }]), [
    ["a", "b"],
  ]);
  assert.deepEqual(
    campusConflicts([a, { ...a, id: "b", start: "2027-01-06T11:00", end: "2027-01-06T12:00" }]),
    [],
  );
});
test("学校正文不混入导航和相关推荐，发布日期不采用抓取日期", () => {
  const html =
    '<nav>首页考试</nav><span>发布时间：2026-11-12</span><div class="wp_articlecontent"><p>实际通知正文，包含课程报名和考试安排。</p><p>请在原文核对适用范围。</p></div><footer>更多新闻</footer>';
  assert.ok(campusArticle(html).includes("实际通知正文"));
  assert.ok(!campusArticle(html).includes("更多新闻"));
  assert.equal(campusPublicationDate(html, "https://school.edu.cn/x"), "2026-11-12");
  assert.throws(() => campusArticle("<nav>只有导航</nav>"));
  assert.throws(() => campusPublicationDate("没有日期", "https://school.edu.cn/x"));
});
function material(id, text) {
  return {
    id,
    version: 1,
    parseStatus: "text_extracted",
    segments: [{ segmentIndex: 0, location: "第1段", text }],
  };
}
test("统一审查：明确角色同义字段可比较；不同角色、单份材料不混比", () => {
  assert.equal(
    materialConsistency([material("a", "申请人姓名：张三"), material("b", "申请人名字：张三")])[0]
      .verdict,
    "passed",
  );
  assert.equal(
    materialConsistency([material("a", "申请人姓名：张三"), material("b", "申请人姓名：李四")])[0]
      .verdict,
    "failed",
  );
  assert.deepEqual(
    materialConsistency([material("a", "申请人姓名：张三"), material("b", "导师姓名：李四")]),
    [],
  );
  assert.deepEqual(materialConsistency([material("a", "姓名：张三")]), []);
  assert.equal(
    materialConsistency([material("a", "姓名：张三"), material("b", "姓名：张三")])[0].verdict,
    "needs_confirmation",
  );
  assert.equal(
    materialConsistency([
      material("a", "申请人身份证号：123***"),
      material("b", "申请人证件号码：123***"),
    ])[0].verdict,
    "needs_confirmation",
  );
});

test("校园助手按北京时间本周/今天筛选，不把未知或已完成事项当本周", () => {
  const events = [
    { id: "today", kind: "作业", end: "2026-11-15T18:00", start: "", done: false },
    { id: "future", kind: "考试", start: "2027-01-06", end: "", done: false },
    { id: "unknown", kind: "作业", start: "", end: "", done: false },
    { id: "done", kind: "作业", start: "", end: "2026-11-15", done: true },
  ];
  assert.deepEqual(
    campusQuestionEvents(events, "本周有哪些作业", Date.parse("2026-11-15T09:00:00+08:00")).map(
      (event) => event.id,
    ),
    ["today"],
  );
  assert.deepEqual(
    campusQuestionEvents(events, "今天先做什么", Date.parse("2026-11-14T23:00:00Z")).map(
      (event) => event.id,
    ),
    ["today"],
  );
});
