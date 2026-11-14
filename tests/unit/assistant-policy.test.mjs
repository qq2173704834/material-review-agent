import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantPolicy } from "../../src/lib/assistant-policy.ts";
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
