import { test } from "node:test";
import assert from "node:assert/strict";
import { goalReviewPolicy } from "../../src/lib/goal-review-policy.ts";
import { sourceProvenanceInputSchema } from "../../src/domain/source-provenance.ts";

test("自动预审限额有界，独立开关不改变手动任务策略", () => {
  assert.deepEqual(goalReviewPolicy({}), { enabled: true, dailyLimit: 5 });
  assert.deepEqual(goalReviewPolicy({ AUTO_REVIEW_ENABLED: "off", AUTO_REVIEW_DAILY_LIMIT: "2" }), {
    enabled: false,
    dailyLimit: 2,
  });
  for (const value of ["0", "21", "NaN", "1.5"]) {
    assert.equal(goalReviewPolicy({ AUTO_REVIEW_DAILY_LIMIT: value }).dailyLimit, 5);
  }
});

test("来源关系待核实不能标已核对，凭据与非HTTPS依据拒绝", () => {
  const valid = {
    organizer: "合成主办单位",
    relationship: "主办机构",
    referenceUrl: "https://www.neea.edu.cn/",
    quote: "合成关系依据仅用于结构校验。",
    result: "已核对",
  };
  assert.equal(sourceProvenanceInputSchema.safeParse(valid).success, true);
  assert.equal(
    sourceProvenanceInputSchema.safeParse({ ...valid, relationship: "待核实" }).success,
    false,
  );
  for (const referenceUrl of [
    "http://www.neea.edu.cn/",
    "https://user:password@www.neea.edu.cn/",
    "https://www.neea.edu.cn:8443/",
  ]) {
    assert.equal(sourceProvenanceInputSchema.safeParse({ ...valid, referenceUrl }).success, false);
  }
});
