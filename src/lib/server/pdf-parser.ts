import "server-only";

import { createCanvas } from "@napi-rs/canvas";
import type * as PdfJs from "pdfjs-dist";
import type { MaterialPageCoverage, MaterialContentSegment } from "@/domain/review";
import type { ParsedMaterial } from "./material-parser";
import { recognizeImageText } from "./image-ocr";

const MAXIMUM_PDF_PAGES = 200;
const MAXIMUM_OCR_PAGES = 20;
const MAXIMUM_RENDER_PIXELS = 8_000_000;
const MAXIMUM_RENDER_EDGE = 4_096;
const PDF_TIMEOUT_MS = 120_000;

/** Read text pages directly; rasterize image-bearing pages once to avoid duplicate text. */
export async function parsePdfMaterial(
  buffer: Buffer,
  onlyPage?: number,
  signal?: AbortSignal,
): Promise<ParsedMaterial> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof PdfJs;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const totalTimer = setTimeout(() => {
    void loadingTask.destroy().catch(() => undefined);
  }, PDF_TIMEOUT_MS);
  let document: PdfJs.PDFDocumentProxy;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    clearTimeout(totalTimer);
    await loadingTask.destroy();
    throw error;
  }
  const pageCoverage: MaterialPageCoverage[] = [];
  const segments: MaterialContentSegment[] = [];
  let extractedText = "";
  let ocrPageCount = 0;
  const deadline = Date.now() + PDF_TIMEOUT_MS;
  const imageOperators = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintImageMaskXObjectRepeat,
    pdfjs.OPS.paintInlineImageXObjectGroup,
    pdfjs.OPS.paintImageMaskXObjectGroup,
  ]);
  function appendText(text: string, pageNumber: number, isOcr: boolean): void {
    const normalized = text.trim();
    if (!normalized) return;
    if (extractedText) extractedText += "\n";
    const startOffset = extractedText.length;
    extractedText += normalized;
    segments.push({
      segmentIndex: segments.length,
      text: normalized,
      startOffset,
      endOffset: extractedText.length,
      location: `第 ${pageNumber} 页${isOcr ? " · OCR" : ""}`,
    });
  }
  try {
    for (
      let pageNumber = onlyPage ?? 1;
      pageNumber <= Math.min(document.numPages, onlyPage ?? MAXIMUM_PDF_PAGES);
      pageNumber++
    ) {
      if (Date.now() >= deadline || signal?.aborted) {
        pageCoverage.push({
          pageNumber,
          method: "none",
          status: "skipped",
          message: signal?.aborted ? "请求已取消，未继续处理此页。" : "达到单文件 120 秒处理时限。",
        });
        continue;
      }
      let page: PdfJs.PDFPageProxy | undefined;
      let nativeText = "";
      try {
        page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const rows: Array<{ y: number; items: Array<{ x: number; width: number; text: string }> }> =
          [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const y = item.transform[5] as number;
          const x = item.transform[4] as number;
          let row = rows.find((row) => Math.abs(row.y - y) < 2);
          if (!row) {
            row = { y, items: [] };
            rows.push(row);
          }
          row.items.push({ x, width: item.width, text: item.str });
        }
        nativeText = rows
          .sort((a, b) => b.y - a.y)
          .map((row) =>
            row.items
              .sort((a, b) => a.x - b.x)
              .map((item, index) => {
                const previous = row.items[index - 1];
                return (
                  (previous && item.x - previous.x - previous.width > 20
                    ? " | "
                    : index
                      ? " "
                      : "") + item.text
                );
              })
              .join(""),
          )
          .join("\n")
          .trim();
        const operators = await page.getOperatorList();
        const hasImages = operators.fnArray.some((operator) => imageOperators.has(operator));
        if (nativeText && !hasImages) {
          appendText(nativeText, pageNumber, false);
          pageCoverage.push({
            pageNumber,
            method: "text",
            status: "read",
            message: "已读取文本层；不验证版式、签章或图形语义。",
          });
          continue;
        }
        if (ocrPageCount >= MAXIMUM_OCR_PAGES) {
          appendText(nativeText, pageNumber, false);
          pageCoverage.push({
            pageNumber,
            method: nativeText ? "text" : "none",
            status: nativeText ? "partial" : "skipped",
            message: "达到每份 PDF 最多 20 页 OCR 上限，图像内容未识别。",
          });
          continue;
        }
        ocrPageCount++;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          2,
          MAXIMUM_RENDER_EDGE / Math.max(baseViewport.width, baseViewport.height),
          Math.sqrt(MAXIMUM_RENDER_PIXELS / (baseViewport.width * baseViewport.height)),
        );
        if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid page dimensions");
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(
          Math.max(1, Math.floor(viewport.width)),
          Math.max(1, Math.floor(viewport.height)),
        );
        const renderTask = page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
          viewport,
        });
        const renderTimer = setTimeout(
          () => renderTask.cancel(),
          Math.max(1, Math.min(30_000, deadline - Date.now())),
        );
        try {
          await renderTask.promise;
        } finally {
          clearTimeout(renderTimer);
        }
        const result = await recognizeImageText(
          canvas.toBuffer("image/png"),
          Math.max(1, Math.min(30_000, deadline - Date.now())),
        );
        const hasOcrText = Boolean(result.text.trim());
        // Keep native text if OCR fails, but disclose the unread image content.
        appendText(
          hasOcrText
            ? result.lines.length
              ? result.lines.map((line) => line.text).join("\n")
              : result.text
            : nativeText,
          pageNumber,
          hasOcrText,
        );
        pageCoverage.push({
          pageNumber,
          method: hasOcrText ? "ocr" : nativeText ? "text" : "ocr",
          status:
            hasOcrText &&
            result.confidence >= 45 &&
            !result.lines.some((line) => line.inferredColumns)
              ? "read"
              : hasOcrText || nativeText
                ? "partial"
                : "failed",
          confidence: result.confidence,
          message: hasOcrText
            ? "已识别整页文字；OCR 分数不代表漏字率，候选列仅按文字间距推断，合并单元格需人工核对；不验证签章真伪。"
            : "未识别到可用 OCR 文字；请核对原页或上传更清晰版本。",
        });
      } catch {
        appendText(nativeText, pageNumber, false);
        pageCoverage.push({
          pageNumber,
          method: nativeText ? "text" : "none",
          status: nativeText ? "partial" : "failed",
          message: "本页读取或 OCR 失败/超时；其余页面继续处理，可上传修订版重试。",
        });
      } finally {
        page?.cleanup();
      }
    }
    const isComplete =
      (onlyPage !== undefined || document.numPages <= MAXIMUM_PDF_PAGES) &&
      pageCoverage.every((page) => page.status === "read");
    const unreadPages = pageCoverage
      .filter((page) => page.status !== "read")
      .map((page) => page.pageNumber);
    return {
      mediaType: "application/pdf",
      extension: "pdf",
      parseStatus: isComplete && extractedText ? "text_extracted" : "partial",
      parserName: ocrPageCount ? "pdfjs-dist+tesseract.js+rows-v2" : "pdfjs-dist+rows-v2",
      extractedText,
      segments,
      pageCount: document.numPages,
      sheetNames: [],
      pageCoverage,
      parseMessage: [
        ocrPageCount ? `已对 ${ocrPageCount} 页执行 OCR；请核对识别文字。` : "",
        unreadPages.length ? `读取不完整的页：${unreadPages.join("、")}。` : "",
        document.numPages > MAXIMUM_PDF_PAGES
          ? `第 201–${document.numPages} 页超出 200 页处理上限，未读取。`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  } finally {
    clearTimeout(totalTimer);
    await loadingTask.destroy();
  }
}
