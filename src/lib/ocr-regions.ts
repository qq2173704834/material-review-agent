import type { MaterialRegion } from "../domain/review";
interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  inferredColumns: boolean;
  confidence?: number;
  candidateCell?: { row: number; column: number };
}
export function ocrRegion(
  line: OcrLine,
  width: number,
  height: number,
  pageNumber: number,
  index: number,
): MaterialRegion {
  const x = Math.max(0, Math.min(1, line.bbox.x0 / width));
  const y = Math.max(0, Math.min(1, line.bbox.y0 / height));
  return {
    pageNumber,
    box: {
      x,
      y,
      width: Math.max(0, Math.min(1 - x, (line.bbox.x1 - line.bbox.x0) / width)),
      height: Math.max(0, Math.min(1 - y, (line.bbox.y1 - line.bbox.y0) / height)),
    },
    role: line.inferredColumns ? "table" : y < 0.06 ? "header" : y > 0.94 ? "footer" : "body",
    ...(line.candidateCell
      ? {
          cell: {
            tableId: `candidate-page-${pageNumber}`,
            row: line.candidateCell.row,
            column: line.candidateCell.column,
            rowSpan: 1,
            columnSpan: 1,
          },
        }
      : {}),
    readingOrder: index,
    status: "candidate",
    recognition: "unknown",
    confidence: line.confidence,
    note: "OCR区域候选；阅读顺序、页眉页脚与表格关系尚未经人工确认。",
  };
}
