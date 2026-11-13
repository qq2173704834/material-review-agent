import "server-only";
import JSZip from "jszip";
import { readZipEntry } from "./zip-entry";

export interface ArchiveMaterial {
  name: string;
  bytes: Uint8Array;
  origin: string;
}
export async function expandMaterialArchive(
  buffer: Buffer,
  name: string,
): Promise<ArchiveMaterial[]> {
  const output: ArchiveMaterial[] = [];
  let total = 0;
  let entries = 0;
  async function expand(bytes: Uint8Array, prefix: string, depth: number): Promise<void> {
    if (depth > 2) throw new Error("压缩包嵌套最多2层。");
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
    const files = Object.values(zip.files);
    if (files.length + entries > 100) throw new Error("压缩包条目最多100个（含目录与嵌套包）。");
    entries += files.length;
    for (const entry of files) {
      const original =
        (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
      if (
        /^[\\/]|^[a-z]:|[\p{Cc}]|\\/iu.test(original) ||
        original.split("/").some((part) => part === ".." || part === ".")
      )
        throw new Error("压缩包包含越界或非法路径，已拒绝整个包。");
      if (entry.dir) continue;
      const metadata = entry as typeof entry & {
        _data?: { uncompressedSize?: number; compressedSize?: number };
      };
      const expanded = metadata._data?.uncompressedSize;
      const compressed = metadata._data?.compressedSize;
      if (
        typeof expanded !== "number" ||
        expanded < 0 ||
        expanded > 20 * 1024 * 1024 ||
        typeof compressed !== "number" ||
        (expanded > 1024 * 1024 && expanded / Math.max(1, compressed) > 200)
      )
        throw new Error("压缩条目大小或膨胀比例超限。");
      total += expanded;
      if (total > 50 * 1024 * 1024) throw new Error("压缩包总展开量超过50MiB。");
      const content = await readZipEntry(entry, expanded);
      if (content.byteLength !== expanded) throw new Error("压缩条目实际大小与目录声明不一致。");
      const origin = `${prefix}/${original}`;
      if (/\.zip$/i.test(original)) {
        await expand(content, origin, depth + 1);
        continue;
      }
      if (output.length >= 50) throw new Error("每次解包最多50份材料。");
      if (!/\.(pdf|docx|txt|xlsx|csv|png|jpe?g|mp4|webm|mov|md|json|ya?ml)$/i.test(original))
        throw new Error(`包内格式暂不支持：${original.slice(0, 120)}，请移除后重新上传。`);
      output.push({
        name: origin.replace(/[\\/:*?"<>|]/gu, "_").slice(-180),
        bytes: content,
        origin,
      });
    }
  }
  await expand(new Uint8Array(buffer), name, 0);
  if (!output.length) throw new Error("压缩包没有可导入材料。");
  return output;
}
