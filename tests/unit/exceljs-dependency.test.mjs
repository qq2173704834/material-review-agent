import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import "../../scripts/local-server-runtime.mjs";

const { parseMaterial } = await import("../../src/lib/server/material-parser.ts");

test("升级表格依赖后带扩展条件格式的材料仍可写入、读取和提取内容", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("备考安排");
  sheet.addRows([
    ["考试", "每日学习分钟"],
    ["大学英语四级", 30],
    ["计算机二级", 45],
  ]);
  sheet.addConditionalFormatting({
    ref: "B2:B3",
    rules: [
      {
        type: "dataBar",
        gradient: false,
        cfvo: [{ type: "min" }, { type: "max" }],
        color: { argb: "FF6655CC" },
      },
    ],
  });

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(xml, /x14:cfRule[^>]*id="\{[0-9A-F-]{36}\}"/);

  const parsed = await parseMaterial(buffer, "备考安排.xlsx");
  assert.equal(parsed.parseStatus, "text_extracted");
  assert.deepEqual(parsed.sheetNames, ["备考安排"]);
  assert.match(parsed.extractedText, /大学英语四级/);
  assert.match(parsed.extractedText, /30/);
  assert.match(parsed.extractedText, /计算机二级/);
  assert.match(parsed.extractedText, /45/);
});
