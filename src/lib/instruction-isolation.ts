/** Detection is advisory; the execution boundary never runs instructions found in material data. */
export function containsInstructionOverride(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\\u([a-f\d]{4})/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(
      /&#(?:x([a-f\d]+)|(\d+));/gi,
      (_, hex: string | undefined, decimal: string | undefined) => {
        const point = Number.parseInt(hex ?? decimal ?? "0", hex ? 16 : 10);
        return point <= 0x10ffff ? String.fromCodePoint(point) : "";
      },
    );
  const pattern =
    /(?:忽略|无视|覆盖|跳过).{0,16}(?:先前|之前|以上|所有|系统).{0,8}(?:指令|规则|要求|提示词)|(?:ignore|disregard|override).{0,40}(?:previous|above|system|all).{0,20}(?:instructions?|rules?|prompt)|(?:泄漏|输出|显示).{0,12}(?:系统)?(?:提示词|密钥)|(?:执行|运行).{0,12}(?:命令|代码)|(?:reveal|print|show).{0,24}(?:system prompt|api key)|(?:run|execute).{0,24}(?:command|code)|(?:system|assistant)\s*[:：].{0,30}(?:ignore|override|忽略)|(?:忽略|ignore).{0,30}(?:返回通过|return passed|all passed)/i;
  if (pattern.test(normalized)) return true;
  // Inspect a bounded number of explicit encoded blocks; never interpret decoded content as executable input.
  const blocks = normalized.match(/(?:base64\s*[:：=]\s*)[A-Za-z\d+/=]{16,4096}/gi) ?? [];
  return blocks.slice(0, 20).some((block) => {
    const encoded = block.replace(/^base64\s*[:：=]\s*/i, "");
    try {
      const decoded = globalThis.atob(encoded).replace(/[\u200B-\u200F\uFEFF]/g, "");
      return pattern.test(decoded);
    } catch {
      return true;
    }
  });
}
