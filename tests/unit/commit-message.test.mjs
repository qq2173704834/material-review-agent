import assert from "node:assert/strict";
import test from "node:test";

import { validateCommitMessage } from "../../scripts/validate-commit.mjs";

test("接受项目格式、CRLF 及分条正文", () => {
  assert.deepEqual(
    validateCommitMessage(
      "[build(ENG-002)]: 初始化应用工程\r\n\r\n目的：提供可运行工程。\r\n变更：\r\n- 初始化基础。\r\n验证：实际检查通过。\r\n",
    ),
    [],
  );
});

test("接受需求和已登记缺陷的编号格式", () => {
  for (const title of ["[feat(M01)]: 上传材料", "[fix(BUG-001)]: 修复上传失败"]) {
    assert.deepEqual(
      validateCommitMessage(`${title}\n\n目的：说明目的。\n变更：说明变更。\n验证：说明结果。`),
      [],
    );
  }
});

test("拒绝默认 Conventional Commits、缺少括号或冒号位置错误", () => {
  for (const title of [
    "feat(M01): 上传",
    "[feat(M01):] 上传",
    "[feat(upload)]: 上传",
    "[style(ENG-002)]: styling",
  ]) {
    assert.notDeepEqual(
      validateCommitMessage(`${title}\n\n目的：目的。\n变更：变更。\n验证：结果。`),
      [],
    );
  }
});

test("拒绝缺失空行、空字段、缺失验证及乱序正文", () => {
  for (const body of [
    "目的：目的。\n变更：变更。\n验证：结果。",
    "\n目的：\n变更：变更。\n验证：结果。",
    "\n目的：目的。\n变更：变更。",
    "\n验证：结果。\n目的：目的。\n变更：变更。",
  ]) {
    assert.notDeepEqual(validateCommitMessage(`[test(ENG-003)]: 测试提交格式\n${body}`), []);
  }
});
