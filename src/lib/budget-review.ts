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

export function compareBudgetRatio(
  description: string,
  materials: ReviewMaterialSummary[],
): ReturnType<typeof compareBudgetTotal> {
  if (!/预算|金额|费用/.test(description) || !/占比|比例/.test(description)) return;
  const constraint = description.match(
    /([\p{L}\p{N}]{1,30})(?:占比|比例)(?:必须)?(不超过|不得超过|至少|不少于|小于|大于|恰好)\s*(\d+(?:\.\d{1,4})?)\s*[%％]/u,
  );
  const evidence: ReviewCheckResult["evidence"] = [];
  const unknown = (reason: string): ReturnType<typeof compareBudgetTotal> => ({
    verdict: "needs_confirmation",
    reason,
    recommendation: "请明确项目名称、占总额比例、同一单位金额列及唯一合计行；零总额不能计算比例。",
    evidence,
  });
  if (!constraint || !materials.length) return unknown("比例要求或待核验预算不完整。");
  const category = constraint[1]!.replace(/^.*(?:中|的)/, "");
  let passes = true;
  const summaries: string[] = [];
  for (const material of materials) {
    if (!["csv", "xlsx"].includes(material.extension) || material.parseStatus !== "text_extracted")
      return unknown("比例校验要求完整CSV/XLSX单元格。");
    const headers = material.segments.filter((segment) =>
      /金额\s*[（(]\s*(?:元|万元)\s*[）)]/.test(segment.text),
    );
    if (headers.length !== 1) return unknown("金额列或单位不唯一。");
    const header = headers[0]!;
    const column = header.text
      .split("|")
      .findIndex((cell) => /^\s*金额\s*[（(]\s*(?:元|万元)\s*[）)]\s*$/.test(cell));
    if (column < 1) return unknown("金额列无法定位。");
    let numerator: bigint | undefined;
    let denominator: bigint | undefined;
    for (const row of material.segments.filter(
      (segment) => segment.segmentIndex > header.segmentIndex,
    )) {
      const cells = row.text.split("|").map((cell) => cell.trim());
      const label = cells.slice(0, column).join(" ");
      if (label !== category && !/^(?:合计|总计|总额)$/.test(label)) continue;
      const value = cells[column];
      if (!value || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value))
        return unknown("比例涉及的金额为空、负数或精度超过两位。");
      const [whole, fraction = ""] = value.split(".");
      const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
      if (label === category) {
        if (numerator !== undefined) return unknown("比例项目存在重名明细。");
        numerator = cents;
      } else {
        if (denominator !== undefined) return unknown("预算存在多个合计行。");
        denominator = cents;
      }
      evidence.push({
        materialId: material.id,
        materialVersion: material.version,
        segmentIndex: row.segmentIndex,
        location: row.location,
        quotedText: row.text,
      });
    }
    if (
      numerator === undefined ||
      denominator === undefined ||
      denominator === 0n ||
      numerator > denominator
    )
      return unknown("项目金额或总额不完整，或总额为零/小于明细。");
    const [whole, fraction = ""] = constraint[3]!.split(".");
    const percentage = BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0"));
    const left = numerator * 100n * 10000n;
    const right = denominator * percentage;
    const operator = constraint[2];
    passes &&= ["至少", "不少于"].includes(operator!)
      ? left >= right
      : operator === "小于"
        ? left < right
        : operator === "大于"
          ? left > right
          : operator === "恰好"
            ? left === right
            : left <= right;
    summaries.push(
      `${material.originalFileName}：${category}金额/合计金额=${numerator}/${denominator}（同单位最小精度），要求${operator}${constraint[3]}%`,
    );
  }
  return {
    verdict: passes ? "passed" : "failed",
    reason: summaries.join("；") + "；以整数交叉相乘精确比较，不按显示百分比四舍五入。",
    recommendation: passes ? "" : "核对预算分配比例后复检。",
    evidence,
  };
}
