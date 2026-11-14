import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMockRules } from "../../src/lib/rule-extractor.ts";

test("PDF页片段内拆句保留真实编号和全局偏移，空行不重排行号", () => {
  const first = "第一页标题\n\n必须提交学籍证明。\n文件不超过2页。";
  const second = "第二页\n\n须提交成绩证明；建议提供说明。";
  const noticeText = first + "\n\n" + second;
  const sourceSegments = [
    { paragraphIndex: 8, text: first, startOffset: 0, endOffset: first.length },
    {
      paragraphIndex: 13,
      text: second,
      startOffset: first.length + 2,
      endOffset: noticeText.length,
    },
  ];
  const { rules } = extractMockRules({
    taskId: "synthetic-task",
    sourceId: "synthetic-source",
    sourceVersion: 1,
    noticeText,
    sourceSegments,
  });
  assert.ok(rules.length >= 4);
  assert.deepEqual([...new Set(rules.map((rule) => rule.source.paragraphIndex))], [8, 13]);
  for (const rule of rules) {
    const source = rule.source;
    const segment = sourceSegments.find((entry) => entry.paragraphIndex === source.paragraphIndex);
    assert.ok(source.startOffset >= segment.startOffset && source.endOffset <= segment.endOffset);
    assert.equal(noticeText.slice(source.startOffset, source.endOffset), source.quotedText);
  }
});
