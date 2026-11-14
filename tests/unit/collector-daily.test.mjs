import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
test("每日采集真实持久层在受控时间下验证重启、跨日和草稿幂等", () => {
  const result = execFileSync(
    process.execPath,
    ["--experimental-transform-types", "tests/scripts/collector-daily-check.mjs"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.match(result, /不自动发布通过/);
});
