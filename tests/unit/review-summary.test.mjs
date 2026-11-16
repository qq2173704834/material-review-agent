import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewSummary } from "../../src/lib/review-summary.ts";
const execution = {
  validity: "current",
  status: "completed",
  results: [{ verdict: "passed", strength: "required" }],
  unexecutedCount: 0,
  metadata: { mode: "live" },
};
test("UXR043 只有完整当前检查才给出无必须项问题结论", () => {
  assert.equal(reviewSummary(execution).title, "本次自查未发现必须项问题");
  assert.match(reviewSummary({ ...execution, validity: "needs_recheck" }).title, /需要重新检查/);
  assert.match(reviewSummary({ ...execution, status: "failed" }).title, /尚未完成/);
  assert.match(reviewSummary({ ...execution, unexecutedCount: 1 }).title, /需要确认/);
  assert.match(reviewSummary({ ...execution, metadata: { mode: "mock" } }).title, /模拟/);
  assert.match(reviewSummary({ ...execution, results: [] }).title, /尚无/);
});
test("UXR043 必须项失败、待确认与跨文件问题都进入摘要", () => {
  const result = reviewSummary({
    ...execution,
    results: [
      { verdict: "failed", strength: "required" },
      { verdict: "failed", strength: "recommended" },
      { verdict: "unable_to_check" },
    ],
    metadata: {
      mode: "live",
      materialConsistency: [{ verdict: "failed" }, { verdict: "needs_confirmation" }],
    },
  });
  assert.equal(result.failed, 2);
  assert.equal(result.pending, 2);
  assert.equal(result.title, "有材料需要修改");
});
