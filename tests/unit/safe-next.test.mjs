import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "../../src/lib/safe-next.ts";

for (const [name, value] of [
  ["空值", null],
  ["空串", ""],
  ["绝对外站", "https://evil.example/"],
  ["协议相对地址", "//evil.example/path"],
  ["反斜线主机混淆", "/\\evil.example"],
  ["双重编码", "/%252f%252fevil.example"],
  ["编码斜线", "/%2f%2fevil.example"],
  ["控制字符", "/\nevil.example"],
  ["前置空格", " /exams"],
  ["脚本协议", "javascript:alert(1)"],
]) {
  test(`登录回跳拒绝${name}`, () => assert.equal(safeNext(value), "/exams"));
}
for (const value of ["/exams", "/account", "/exams?category=cet4&page=2#results"]) {
  test(`登录回跳保留站内路径 ${value}`, () => assert.equal(safeNext(value), value));
}
