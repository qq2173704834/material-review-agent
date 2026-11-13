import "server-only";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import type JSZip from "jszip";

/** Enforce actual decompressed output, then verify CRC; directory metadata alone is insufficient. */
export async function readZipEntry(
  entry: JSZip.JSZipObject,
  maximumBytes: number,
): Promise<Buffer> {
  const stream = new Readable().wrap(entry.nodeStream());
  const timer = setTimeout(() => stream.destroy(new Error("压缩条目读取超时。")), 10000);
  let count = 0,
    checksum = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const output of stream) {
      if (!Buffer.isBuffer(output)) throw new Error("压缩条目数据无效。");
      count += output.length;
      if (count > maximumBytes) throw new Error("压缩条目实际展开量超限。");
      checksum = crc32(output, checksum);
      chunks.push(output);
    }
    const expected = (entry as JSZip.JSZipObject & { _data?: { crc32?: number } })._data?.crc32;
    if (typeof expected !== "number" || expected >>> 0 !== checksum)
      throw new Error("压缩条目CRC校验失败，可能损坏。");
    return Buffer.concat(chunks, count);
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
}
