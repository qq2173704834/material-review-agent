import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeHtml } from "../../src/lib/html-decoding.ts";
const legacy = (head) =>
  Buffer.concat([Buffer.from(head), Buffer.from("d6d0cec4", "hex"), Buffer.from("</title>")]);
test("仅HTML声明的GB2312/GBK页面保留中文标题而非乱码", () => {
  for (const head of [
    '<meta http-equiv="Content-Type" content="text/html; charset=gb2312"><title>',
    '<meta charset="gbk"><title>',
    "<META CHARSET=GB18030><title>",
  ]) {
    assert.ok(decodeHtml(legacy(head), "text/html").includes("<title>中文</title>"));
  }
});
test("BOM与HTTP声明优先、注释内声明不生效，未知编码明确拒绝", () => {
  const text = "<meta charset=gbk><title>中文</title>";
  assert.equal(decodeHtml(Buffer.from(text), "text/html;charset=utf-8"), text);
  assert.equal(
    decodeHtml(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
      "text/html;charset=gbk",
    ),
    text,
  );
  const comment = "<!-- <meta charset=gbk> --><title>中文</title>";
  assert.equal(decodeHtml(Buffer.from(comment), "text/html"), comment);
  assert.throws(
    () => decodeHtml(Buffer.from("<meta charset=not-a-real-encoding>"), "text/html"),
    /不支持/,
  );
});
