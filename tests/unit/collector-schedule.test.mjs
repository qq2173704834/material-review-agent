import { test } from "node:test";
import assert from "node:assert/strict";
import { dueCollectorSources } from "../../src/lib/collector-schedule.ts";

const now = Date.parse("2026-11-15T08:00:00+08:00");
const source = (id, overrides = {}) => ({
  id,
  enabled: 1,
  failures: 0,
  last_attempt: null,
  next_run: 0,
  ...overrides,
});
const ids = (items, time = now, hour = 8) =>
  dueCollectorSources(items, time, hour).map((s) => s.id);

test("每日补查不能绕过跨日失败退避，到期才重试", () => {
  const failed = source("failed", {
    failures: 2,
    last_attempt: "2026-11-14T23:00:00+08:00",
    next_run: now + 3600000,
  });
  assert.deepEqual(ids([failed]), []);
  assert.deepEqual(ids([failed], now + 3600000), ["failed"]);
});
test("健康来源在北京时间指定小时补查，每日只补一次", () => {
  const healthy = source("healthy", {
    last_attempt: "2026-11-14T23:00:00+08:00",
    next_run: now + 86400000,
  });
  assert.deepEqual(ids([healthy], now - 1), []);
  assert.deepEqual(ids([healthy]), ["healthy"]);
  assert.deepEqual(ids([{ ...healthy, last_attempt: new Date(now).toISOString() }]), []);
});
test("停机后到期来源补查，禁用来源不执行且正常间隔不受每日小时限制", () => {
  assert.deepEqual(ids([source("off", { enabled: 0 }), source("overdue")], now - 3600000), [
    "overdue",
  ]);
});
test("按最久未尝试排序防止前两个来源一直占位，不修改输入顺序", () => {
  const items = [
    source("recent", { last_attempt: new Date(now - 1000).toISOString() }),
    source("older", { last_attempt: new Date(now - 5000).toISOString() }),
    source("never"),
  ];
  assert.deepEqual(ids(items), ["never", "older"]);
  assert.deepEqual(
    items.map((s) => s.id),
    ["recent", "older", "never"],
  );
  assert.deepEqual(dueCollectorSources(items, now, 8, 0), []);
});
test("无效配置回退到8点，无效历史时间视为需要核查", () => {
  const item = source("invalid", { last_attempt: "invalid", next_run: now + 1000 });
  assert.deepEqual(ids([item], now - 1, NaN), []);
  assert.deepEqual(ids([item], now, 24), ["invalid"]);
});
