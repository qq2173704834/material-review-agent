import {
  extractNumericBounds,
  satisfiesBound,
  describeBound,
  incompatibleBounds,
} from "./numeric-constraints";
import type { ReviewCheckResult, ReviewMaterialSummary } from "@/domain/review";

export function compareExtendedNumericRule(
  description: string,
  materials: ReviewMaterialSummary[],
): Pick<ReviewCheckResult, "verdict" | "reason" | "recommendation" | "evidence"> | undefined {
  // Legacy single upper bounds retain their established wording; handle additional scopes/bounds here.
  const allBounds = extractNumericBounds(description);
  const isAdvanced =
    /总大小|合计|累计|总计|总文件|至少|不少于|不低于|不小于|大于|小于|少于|多于|恰好|正好|等于|[<>≥]|\d\s*(?:至|到|[-~～—])/.test(
      description,
    ) || allBounds.length > 1;
  if (!isAdvanced || !allBounds.length) return undefined;
  if (/正文|摘要|指定范围/.test(description)) return undefined;
  const byteUnits: Record<string, number> = {
    B: 1,
    字节: 1,
    KB: 1000,
    KIB: 1024,
    MB: 1_000_000,
    MIB: 1_048_576,
    GB: 1_000_000_000,
    GIB: 1_073_741_824,
  };
  const kinds = new Set(
    allBounds.map((bound) =>
      bound.unit in byteUnits
        ? "size"
        : bound.unit === "页"
          ? "pages"
          : ["份", "个", "件", "项"].includes(bound.unit)
            ? "count"
            : "unsupported",
    ),
  );
  if (kinds.size !== 1 || kinds.has("unsupported")) return undefined;
  const kind = [...kinds][0];
  const bounds = allBounds.map((bound) => ({
    ...bound,
    value: bound.value * (byteUnits[bound.unit] ?? 1),
  }));
  const boundText = allBounds.map(describeBound).join("且");
  if (incompatibleBounds(bounds))
    return {
      verdict: "needs_confirmation",
      reason: "要求中的数值上下界相互矛盾：" + boundText,
      recommendation: "对照来源纠正规则或选择采用依据。",
      evidence: [],
    };
  const evidence = materials.map((material) => ({
    materialId: material.id,
    materialVersion: material.version,
    quotedText: `${material.originalFileName} · ${material.fileSizeBytes} 字节${material.pageCount === null ? "" : ` · ${material.pageCount} 页`}`,
    location: "文件属性",
  }));
  if (!materials.length && kind !== "count")
    return {
      verdict: "needs_confirmation",
      reason: "尚无材料可核对规格范围。",
      recommendation: "上传并关联材料后复检。",
      evidence: [],
    };
  if (
    kind === "pages" &&
    materials.some((material) => material.extension !== "pdf" || material.pageCount === null)
  )
    return {
      verdict: "unable_to_check",
      reason: "指定材料不是可读取总页数的 PDF，无法可靠比较。",
      recommendation: "上传有效 PDF 或人工核验。",
      evidence,
    };
  const isTotal = /总大小|合计|累计|总计|总文件/.test(description);
  const values =
    kind === "count"
      ? [{ label: "文件数量", value: materials.length }]
      : kind === "size" && isTotal
        ? [
            {
              label: "文件总大小（字节）",
              value: materials.reduce((sum, material) => sum + material.fileSizeBytes, 0),
            },
          ]
        : materials.map((material) => ({
            label: material.originalFileName + (kind === "size" ? "（字节）" : "（PDF 总页数）"),
            value: kind === "size" ? material.fileSizeBytes : material.pageCount!,
          }));
  const passes = values.every(({ value }) => bounds.every((bound) => satisfiesBound(value, bound)));
  return {
    verdict: passes ? "passed" : "failed",
    reason: `${values.map(({ label, value }) => `${label}：${value}`).join("；")}。要求${boundText}，${passes ? "符合" : "不符合"}；范围：${isTotal ? "关联材料合计" : kind === "count" ? "关联材料份数" : "逐份文件属性"}。`,
    recommendation: passes
      ? ""
      : "按要求调整关联材料后复检。KB/MB/GB 使用十进制，KiB/MiB/GiB 使用二进制。",
    evidence,
  };
}
