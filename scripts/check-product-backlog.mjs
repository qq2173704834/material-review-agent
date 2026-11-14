import { readFileSync } from "node:fs";
const definitions = [
  "docs/exam-expansion-requirements.md",
  "docs/exam-learning-portal-requirements.md",
].flatMap((path) =>
  [
    ...readFileSync(new URL("../" + path, import.meta.url), "utf8").matchAll(
      /^- ((?:EXP|PORT)-\d{2}\.A[1-4])：/gm,
    ),
  ].map((match) => match[1]),
);
const recorded = [
  ...readFileSync(new URL("../docs/product-acceptance.md", import.meta.url), "utf8").matchAll(
    /^\| ((?:EXP|PORT)-\d{2}\.A[1-4])\s*\|/gm,
  ),
].map((match) => match[1]);
if (
  definitions.length !== 88 ||
  recorded.length !== 88 ||
  new Set(recorded).size !== 88 ||
  definitions.some((id) => !recorded.includes(id))
)
  throw new Error("88条需求与逐条验收台账存在缺失或重复。");
console.log("EXP/PORT 88条原始条件均有唯一验收记录；本检查不代表功能验收通过。");
