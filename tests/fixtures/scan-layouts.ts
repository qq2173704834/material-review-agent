import { createCanvas } from "@napi-rs/canvas";
export const scanLayouts = [
  {
    id: "printed",
    expected: "独立印刷文字区域",
    lines: [
      ["PRINTED RECORD", 50, 80],
      ["Applicant: ALICE", 50, 200],
    ],
  },
  {
    id: "double-column",
    expected: "左右栏不合并成同一证据区域，阅读顺序先保留候选",
    lines: [
      ["PAGE HEADER", 40, 25],
      ["LEFT COLUMN", 40, 100],
      ["RIGHT COLUMN", 680, 100],
      ["LEFT CONTENT", 40, 220],
      ["RIGHT CONTENT", 680, 220],
      ["NOTE", 1000, 360],
      ["PAGE FOOTER", 40, 490],
    ],
  },
  {
    id: "merged",
    expected: "合并关系需人工确认，保留columnSpan=2",
    lines: [
      ["MERGED HEADER", 50, 90],
      ["Equipment", 50, 220],
      ["1000", 780, 220],
    ],
  },
  {
    id: "cross-page",
    expected: "跨页续表须明确同表标识与前页引用",
    lines: [
      ["BUDGET TABLE", 50, 90],
      ["Equipment", 50, 220],
      ["1000", 780, 220],
    ],
  },
  {
    id: "missing",
    expected: "空白扫描页保持未完整读取，不补造文字",
    lines: [["PARTIAL RECORD", 50, 90]],
  },
] as const;
export function scanLayoutImage(
  layout: (typeof scanLayouts)[number],
  format: "png" | "jpeg" = "png",
): Buffer {
  const canvas = createCanvas(1200, 500),
    context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1200, 500);
  context.fillStyle = "black";
  context.font = "40px Arial";
  for (const [text, x, y] of layout.lines) {
    context.font = text.startsWith("PAGE ") ? "20px Arial" : "40px Arial";
    context.fillText(text, x, y);
  }
  return format === "png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg");
}
