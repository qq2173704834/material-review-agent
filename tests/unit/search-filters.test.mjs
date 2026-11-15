import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchFilters } from "../../src/lib/search-filters.ts";

test("筛选参数重复时取首值，空白及非明确启用的复选值不生效", () => {
  assert.deepEqual(
    normalizeSearchFilters({ goal: [" mine ", "other"], q: "  ", saved: "0", hidden: "true" }),
    { goal: "mine" },
  );
  assert.deepEqual(normalizeSearchFilters({ saved: ["1", "0"], hidden: " 1 " }), {
    saved: "1",
    hidden: "1",
  });
});

test("非法或过大页码被忽略，合法正整数保留供结果页约束", () => {
  for (const page of ["0", "-1", "1.2", "NaN", "Infinity", "10000000", "2x"])
    assert.equal(normalizeSearchFilters({ page }).page, undefined);
  assert.equal(normalizeSearchFilters({ page: "9999999" }).page, "9999999");
});

test("筛选文本限制长度但保留中文、标点和未知目标供权限层处理", () => {
  const filters = normalizeSearchFilters({ q: "考试，学习".repeat(40), goal: "unknown-goal" });
  assert.equal(filters.q.length, 120);
  assert.ok(filters.q.startsWith("考试，学习"));
  assert.equal(filters.goal, "unknown-goal");
});
