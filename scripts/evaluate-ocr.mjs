import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluateOcr } from "./lib/ocr-evaluation.mjs";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "用法：node scripts/evaluate-ocr.mjs 标注集.json 新报告.json。输入只在本机读取。",
  );
const buffer = readFileSync(input);
if (buffer.length > 20 * 1024 ** 2) throw new Error("标注集超过20MiB限额。");
const report = {
  ...evaluateOcr(JSON.parse(buffer.toString("utf8"))),
  datasetSha256: createHash("sha256").update(buffer).digest("hex"),
};
writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ sampleCount: report.samples.length, groups: report.groups }));
