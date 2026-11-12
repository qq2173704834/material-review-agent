import type { ReviewCheckResult, ReviewMaterialSummary } from "@/domain/review";

export function compareBudgetTotal(
  description: string,
  materials: ReviewMaterialSummary[],
): Pick<ReviewCheckResult, "verdict" | "reason" | "recommendation" | "evidence"> | undefined {
  if (!/预算|金额|费用/.test(description) || !/合计|总计|总额|加总/.test(description))
    return undefined;
  const evidence: ReviewCheckResult["evidence"] = [];
  const fail = (reason: string): ReturnType<typeof compareBudgetTotal> => ({
    verdict: "needs_confirmation",
    reason,
    recommendation: "请提供含明确金额单位、明细和合计行的 CSV/XLSX 表格，核对缺失值及公式缓存。",
    evidence,
  });
  if (!materials.length) return fail("没有可核对的预算表格。");
  const comparisons: string[] = [];
  let hasFailure = false;
  for (const material of materials) {
    if (!["csv", "xlsx"].includes(material.extension) || material.parseStatus !== "text_extracted")
      return fail("预算合计仅适用于完整解析的 CSV/XLSX 单元格；OCR 行文本不提供可靠表格结构。");
    const headers = material.segments.filter((segment) =>
      /金额\s*[（(]\s*元\s*[）)]/.test(segment.text),
    );
    if (headers.length !== 1)
      return fail("每份预算表须有唯一的“金额（元）”列头；多表、混合币种或单位不明需先拆分核对。");
    const header = headers[0]!;
    const column = header.text
      .split("|")
      .findIndex((cell) => /^\s*金额\s*[（(]\s*元\s*[）)]\s*$/.test(cell));
    if (column < 0) return fail("金额列无法明确定位。");
    const rows = material.segments.filter((segment) => segment.segmentIndex > header.segmentIndex);
    let total: bigint | undefined;
    let sum = 0n;
    let detailCount = 0;
    for (const row of rows) {
      const cells = row.text.split("|").map((cell) => cell.trim());
      const label = cells.slice(0, column).join(" ");
      const value = cells[column];
      if (!label || !value || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value))
        return fail("预算行存在空金额、非数值、负数或超过两位小数，未采用不可靠合计。");
      const [whole, fraction = ""] = value.split(".");
      const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
      if (/^(合计|总计|总额)$/.test(label)) {
        if (total !== undefined) return fail("预算出现多个总计行，范围不明确。");
        total = cents;
      } else {
        sum += cents;
        detailCount++;
      }
      evidence.push({
        materialId: material.id,
        materialVersion: material.version,
        segmentIndex: row.segmentIndex,
        location: row.location,
        quotedText: row.text,
      });
    }
    if (total === undefined || !detailCount) return fail("缺少预算明细或唯一合计行。");
    const money = (cents: bigint): string =>
      `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
    hasFailure ||= total !== sum;
    comparisons.push(
      `${material.originalFileName}：${detailCount} 条明细之和 ${money(sum)} 元，申报合计 ${money(total)} 元，差额 ${money(total > sum ? total - sum : sum - total)} 元`,
    );
  }
  return {
    verdict: hasFailure ? "failed" : "passed",
    reason: comparisons.join("；") + "。按人民币分精确加总，不重新执行电子表格公式。",
    recommendation: hasFailure ? "核对明细与合计，纠正预算表后复检。" : "",
    evidence,
  };
}
