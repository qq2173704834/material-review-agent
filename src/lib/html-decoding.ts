/** Decode HTML using the declared encoding; never guess a legacy encoding from garbled text. */
export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const bom =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? "utf-8"
      : bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : undefined;
  const header = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  // HTML encoding declarations use ASCII-compatible characters. Bound the prescan.
  const prefix = new TextDecoder("windows-1252")
    .decode(bytes.subarray(0, 4096))
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const meta = prefix.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([a-z0-9._-]+)/i)?.[1];
  // Some public servers concatenate charset tokens. Accept only when the explicit
  // document declaration agrees with the first token; do not guess from body text.
  const declared =
    header?.includes(",") && meta && header.split(",")[0]?.toLowerCase() === meta.toLowerCase()
      ? meta
      : header;
  try {
    return new TextDecoder(bom ?? declared ?? meta ?? "utf-8").decode(bytes);
  } catch {
    throw new Error("网页使用了暂不支持的文字编码。");
  }
}
