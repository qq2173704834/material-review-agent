import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { recognizeImageText } from "./image-ocr";
import type { ParsedMaterial } from "./material-parser";

const run = promisify(execFile);
export function mediaBinary(kind: "ffmpeg" | "ffprobe"): string {
  const override = process.env[kind === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (override) return override;
  if (process.platform !== "win32")
    throw new Error("当前平台请配置 FFMPEG_PATH 和 FFPROBE_PATH 指向本地媒体工具。");
  return resolve(process.cwd(), "node_modules", `@${kind}-installer`, "win32-x64", `${kind}.exe`);
}
const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string().optional(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
  format: z.object({
    duration: z.coerce.number().finite().positive().max(3600),
    format_name: z.string(),
  }),
});
let active = 0;
export async function parseVideoMaterial(
  buffer: Buffer,
  extension: string,
  signal?: AbortSignal,
): Promise<ParsedMaterial> {
  if (active >= 2) throw new Error("视频解析队列已满，请稍后重试。");
  active++;
  const root = resolve(process.env.REVIEW_DATA_DIR?.trim() || ".local-data", "media-tmp");
  let directory: string | undefined;
  try {
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(resolve(root, "parse-"));
    const path = resolve(directory, `source.${extension}`);
    await writeFile(path, buffer, { mode: 0o600 });
    const probe = await run(
      mediaBinary("ffprobe"),
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        path,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, signal },
    );
    const information = probeSchema.parse(JSON.parse(probe.stdout));
    const stream = information.streams.find((item) => item.codec_type === "video");
    if (!stream?.width || !stream.height) throw new Error("没有找到有效视频轨道。");
    if (stream.width * stream.height > 33_177_600) throw new Error("视频分辨率超过8K上限。");
    const metadata = {
      kind: "video",
      durationSeconds: information.format.duration,
      width: stream.width,
      height: stream.height,
      codec: stream.codec_name,
      format: information.format.format_name,
    };
    const blocks = [{ text: JSON.stringify(metadata), location: "视频规格（ffprobe真实读取）" }];
    const count = Math.min(6, Math.max(1, Math.ceil(metadata.durationSeconds / 30)));
    const deadline = Date.now() + 90_000;
    for (let index = 0; index < count; index++) {
      if (signal?.aborted || Date.now() > deadline) break;
      const seconds = Math.min(
        metadata.durationSeconds - 0.01,
        (metadata.durationSeconds * index) / count,
      );
      const frame = resolve(directory, `frame-${index}.png`);
      try {
        await run(
          mediaBinary("ffmpeg"),
          [
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-ss",
            String(seconds),
            "-i",
            path,
            "-frames:v",
            "1",
            "-vf",
            "scale=1280:720:force_original_aspect_ratio=decrease",
            "-y",
            frame,
          ],
          { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true, signal },
        );
        const recognized = await recognizeImageText(await readFile(frame));
        blocks.push({
          text: recognized.text.trim() || "本画面未识别到可用文字。",
          location: `视频 ${seconds.toFixed(2)} 秒 · 抽样画面OCR · 置信度${Math.round(recognized.confidence)}`,
        });
      } catch {
        blocks.push({
          text: "该时间点画面读取失败，请在原视频查看对应位置。",
          location: `视频 ${seconds.toFixed(2)} 秒 · 未读取`,
        });
      }
    }
    let extractedText = "";
    const segments = blocks.map((block, segmentIndex) => {
      if (extractedText) extractedText += "\n";
      const startOffset = extractedText.length;
      extractedText += block.text;
      return { ...block, segmentIndex, startOffset, endOffset: extractedText.length };
    });
    return {
      mediaType:
        extension === "webm" ? "video/webm" : extension === "mov" ? "video/quicktime" : "video/mp4",
      extension,
      parseStatus: "partial",
      parserName: "ffprobe-ffmpeg-sampled-ocr",
      extractedText,
      segments,
      pageCount: null,
      sheetNames: [],
      parseMessage: `规格已读取；${metadata.durationSeconds.toFixed(2)}秒，${metadata.width}×${metadata.height}。最多6个画面抽样OCR，不含音轨理解；其余时段未核验。时间点证据只说明该画面，不表示整段视频内容完整。`,
    };
  } finally {
    active--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
