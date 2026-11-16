import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("BUG073 首屏时间在UTC服务器、上海与洛杉矶浏览器时区保持一致", () => {
  const source = `import { displayDateTime } from './src/lib/display-date.ts';
    console.log(JSON.stringify([
      displayDateTime('2026-11-16T16:30:00.000Z'),
      displayDateTime('2026-11-16T16:30:00.000Z', { dateStyle:'medium', timeStyle:'short' })
    ]));`;
  const outputs = ["UTC", "Asia/Shanghai", "America/Los_Angeles"].map((TZ) =>
    JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", source], {
        cwd: new URL("../../", import.meta.url),
        env: { ...process.env, TZ },
        encoding: "utf8",
      }),
    ),
  );
  assert.match(outputs[0][0], /2026\/11\/17 00:30:00/u);
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0], outputs[2]);
});
