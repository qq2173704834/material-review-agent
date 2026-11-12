import "server-only";

import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";
import JSZip from "jszip";
import sharp from "sharp";

import type {
  MaterialContentSegment,
  MaterialParseStatus,
  MaterialPageCoverage,
} from "@/domain/review";
import { parsePdfMaterial } from "@/lib/server/pdf-parser";
import { recognizeImageText } from "@/lib/server/image-ocr";

const MAXIMUM_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAXIMUM_IMAGE_PIXELS = 25_000_000;
const MAXIMUM_OCR_IMAGE_EDGE = 4_096;
const MINIMUM_COMPLETE_OCR_CONFIDENCE = 45;

export interface ParsedMaterial {
  mediaType: string;
  extension: string;
  parseStatus: MaterialParseStatus;
  parserName: string;
  extractedText: string;
  segments: MaterialContentSegment[];
  pageCount: number | null;
  sheetNames: string[];
  parseMessage: string;
  pageCoverage?: MaterialPageCoverage[];
}

function createSegments(blocks: Array<{ text: string; location: string }>): {
  text: string;
  segments: MaterialContentSegment[];
} {
  let text = "";
  const segments: MaterialContentSegment[] = [];
  for (const block of blocks) {
    const normalized = block.text.trim();
    if (!normalized) continue;
    if (text) text += "\n";
    const startOffset = text.length;
    text += normalized;
    segments.push({
      segmentIndex: segments.length,
      text: normalized,
      startOffset,
      endOffset: text.length,
      location: block.location,
    });
  }
  return { text, segments };
}

async function validateOfficeArchive(buffer: Buffer, requiredPath: string): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.keys(zip.files);
  if (!paths.includes(requiredPath) || !paths.includes("[Content_Types].xml")) {
    throw new Error("文件不是有效的 Office 文档容器。");
  }
  let expandedBytes = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const uncompressedSize = (entry as typeof entry & { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (typeof uncompressedSize !== "number" || uncompressedSize < 0) {
      throw new Error("Office 文档包含无法校验的压缩条目。");
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > MAXIMUM_ARCHIVE_EXPANDED_BYTES) {
      throw new Error("Office 文档解压后超过 100 MiB 安全上限。");
    }
  }
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    await entry.async("uint8array");
  }
}

function assertUtf8(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
}

export async function parseMaterial(
  buffer: Buffer,
  originalFileName: string,
  signal?: AbortSignal,
): Promise<ParsedMaterial> {
  const extension = originalFileName.split(".").pop()?.toLowerCase() ?? "";
  const signature = await fileTypeFromBuffer(buffer);

  if (extension === "txt" || extension === "csv") {
    const content = assertUtf8(buffer);
    const parsed: string[][] =
      extension === "csv"
        ? (parseCsv(content, {
            bom: true,
            skip_empty_lines: true,
            relax_column_count: true,
          }) as unknown as string[][])
        : content.split(/\r?\n/).map((line) => [line]);
    const blocks: Array<{ text: string; location: string }> = parsed.map((row, index) => ({
      text: extension === "csv" ? row.join(" | ") : (row[0] ?? ""),
      location: `行 ${index + 1}`,
    }));
    const result = createSegments(blocks);
    return {
      mediaType: extension === "csv" ? "text/csv" : "text/plain",
      extension,
      parseStatus: result.text ? "text_extracted" : "failed",
      parserName: "utf8-text",
      extractedText: result.text,
      segments: result.segments,
      pageCount: null,
      sheetNames: [],
      parseMessage: result.text ? "" : "文件为空或没有可提取文本。",
    };
  }

  if (extension === "pdf") {
    if (signature?.mime !== "application/pdf") throw new Error("扩展名与 PDF 文件签名不匹配。");
    return parsePdfMaterial(buffer, undefined, signal);
  }

  if (extension === "docx") {
    if (
      signature?.mime !== "application/zip" &&
      signature?.mime !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      throw new Error(`扩展名与 DOCX 文件签名不匹配（检测到 ${signature?.mime ?? "未知类型"}）。`);
    }
    await validateOfficeArchive(buffer, "word/document.xml");
    const officeBuffer = Buffer.from(new Uint8Array(buffer).buffer);
    const result = await mammoth.extractRawText({ buffer: officeBuffer as unknown as Buffer });
    const parsed = createSegments(
      result.value.split(/\r?\n/).map((line, index) => ({
        text: line,
        location: `段落 ${index + 1}`,
      })),
    );
    return {
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension,
      parseStatus: parsed.text ? (result.messages.length ? "partial" : "text_extracted") : "failed",
      parserName: "mammoth",
      extractedText: parsed.text,
      segments: parsed.segments,
      pageCount: null,
      sheetNames: [],
      parseMessage: result.messages.map((message) => message.message).join("；"),
    };
  }

  if (extension === "xlsx") {
    if (
      signature?.mime !== "application/zip" &&
      signature?.mime !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      throw new Error(`扩展名与 XLSX 文件签名不匹配（检测到 ${signature?.mime ?? "未知类型"}）。`);
    }
    await validateOfficeArchive(buffer, "xl/workbook.xml");
    const workbook = new ExcelJS.Workbook();
    const workbookBuffer = Buffer.from(new Uint8Array(buffer).buffer);
    await workbook.xlsx.load(workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const blocks: Array<{ text: string; location: string }> = [];
    for (const worksheet of workbook.worksheets) {
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const cells = row.values as unknown[];
        const values = cells.slice(1).map((cell) => {
          if (cell && typeof cell === "object" && "text" in cell) return String(cell.text);
          if (cell && typeof cell === "object" && "result" in cell) return String(cell.result);
          return cell == null ? "" : String(cell);
        });
        blocks.push({ text: values.join(" | "), location: `${worksheet.name} 第 ${rowNumber} 行` });
      });
    }
    const result = createSegments(blocks);
    return {
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension,
      parseStatus: result.text ? "text_extracted" : "failed",
      parserName: "exceljs",
      extractedText: result.text,
      segments: result.segments,
      pageCount: null,
      sheetNames: workbook.worksheets.map((sheet) => sheet.name),
      parseMessage: result.text ? "" : "工作簿中没有可提取的单元格文本。",
    };
  }

  if (extension === "png" || extension === "jpg" || extension === "jpeg") {
    const expectedMime = extension === "png" ? "image/png" : "image/jpeg";
    if (signature?.mime !== expectedMime) throw new Error("扩展名与图片文件签名不匹配。");
    const image = sharp(buffer, { limitInputPixels: MAXIMUM_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("无法读取图片尺寸，未执行 OCR。");
    const normalizedImage = await image
      .rotate()
      .resize({
        width: MAXIMUM_OCR_IMAGE_EDGE,
        height: MAXIMUM_OCR_IMAGE_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const recognized = await recognizeImageText(normalizedImage);
    const text = recognized.text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const extractedText = text.join("\n");
    let textOffset = 0;
    const segments = text.map((line, segmentIndex) => {
      const startOffset = textOffset;
      textOffset += line.length + 1;
      return {
        segmentIndex,
        text: line,
        startOffset,
        endOffset: startOffset + line.length,
        location: `OCR 第 ${segmentIndex + 1} 行`,
      };
    });
    const hasRecognizedText = Boolean(extractedText);
    const isComplete =
      hasRecognizedText && recognized.confidence >= MINIMUM_COMPLETE_OCR_CONFIDENCE;
    return {
      mediaType: expectedMime,
      extension: extension === "jpeg" ? "jpg" : extension,
      parseStatus: isComplete ? "text_extracted" : hasRecognizedText ? "partial" : "failed",
      parserName: "tesseract.js-chi_sim-eng",
      extractedText,
      segments,
      pageCount: null,
      sheetNames: [],
      parseMessage: !hasRecognizedText
        ? "OCR 未识别到可用文字；请上传更清晰的图片或人工核对。"
        : isComplete
          ? `已提取中文/英文 OCR 文字（识别置信度 ${Math.round(recognized.confidence)}）；请核对识别内容。`
          : `OCR 已提取部分文字，但识别置信度较低（${Math.round(recognized.confidence)}）；请人工核对。`,
    };
  }

  throw new Error("暂不支持该材料格式；当前支持 PDF、DOCX、TXT、XLSX、CSV、JPG 和 PNG。");
}
