import type { ReviewRule } from "@/domain/review-rule";
import type { ReviewCheckResult, ReviewMaterialSummary } from "@/domain/review";

type Comparison = Pick<ReviewCheckResult, "verdict" | "reason" | "recommendation" | "evidence">;
export function compareTemplateRule(
  rule: ReviewRule,
  materials: ReviewMaterialSummary[],
): Comparison | undefined {
  if (!/模板/.test(rule.description) || !/必填|必要结构|必要章节/.test(rule.description)) return;
  const source = [
    rule.source.quotedText,
    ...(rule.additionalSources ?? []).map((item) => item.quotedText),
  ].join("\n");
  const fieldText = source.match(/必填字段\s*[：:]\s*([^\n；;。]+)/)?.[1];
  const headingText = source.match(/(?:必要章节|必要结构)\s*[：:]\s*([^\n；;。]+)/)?.[1];
  const split = (text: string | undefined): string[] =>
    (text ?? "")
      .split(/[、,，]/)
      .map((value) => value.trim().replace(/^[“「『]|[”」』]$/g, ""))
      .filter(Boolean);
  const fields = split(fieldText);
  const headings = split(headingText);
  const evidence: Comparison["evidence"] = [];
  const uncertain = (reason: string): Comparison => ({
    verdict: "needs_confirmation",
    reason,
    recommendation: "导入指定模板来源中的必填字段和必要章节清单，并将该规则关联到填写后的材料。",
    evidence,
  });
  if (!fields.length && !headings.length)
    return uncertain("指定模板没有可定位的显式字段/章节清单；未擅自推断模板标准。");
  if (!materials.length) return uncertain("没有关联待核验的模板填写材料。");
  const problems: string[] = [];
  for (const material of materials) {
    if (material.parseStatus !== "text_extracted")
      return uncertain("部分材料解析不完整，无法断言必填字段缺失。");
    for (const field of fields) {
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(escaped + "\\s*(?:[：:]|\\|)\\s*([^\\n|]+)");
      const segment = material.segments.find((segment) => pattern.test(segment.text));
      const value = segment?.text.match(pattern)?.[1]?.trim();
      if (!value || /^(?:待填|未填|请输入|[_＿\s]+|无|N\/A)$/i.test(value))
        problems.push(`${material.originalFileName}：${field}未填写有效值`);
      if (segment)
        evidence.push({
          materialId: material.id,
          materialVersion: material.version,
          segmentIndex: segment.segmentIndex,
          location: segment.location,
          quotedText: segment.text,
        });
    }
    for (const heading of headings) {
      const segment = material.segments.find((segment) =>
        segment.text
          .split(/\n/)
          .some(
            (line) =>
              line.trim().replace(/^[#\d.、一二三四五六七八九十（）()\s]+/g, "") === heading,
          ),
      );
      if (!segment) problems.push(`${material.originalFileName}：未定位必要章节“${heading}”`);
      else
        evidence.push({
          materialId: material.id,
          materialVersion: material.version,
          segmentIndex: segment.segmentIndex,
          location: segment.location,
          quotedText: segment.text,
        });
    }
  }
  return {
    verdict: problems.length ? "failed" : "passed",
    reason: problems.length
      ? problems.join("；")
      : `按指定来源核验${fields.length}个必填字段和${headings.length}个必要章节；只核验结构与填写状态。`,
    recommendation: problems.length ? "按模板补齐字段或结构后复检；字段内容质量需另行审查。" : "",
    evidence,
  };
}

export function compareScopedCount(
  rule: ReviewRule,
  materials: ReviewMaterialSummary[],
): Comparison | undefined {
  const source = rule.source.quotedText;
  if (
    !/字数|页数|字|页/.test(rule.description) ||
    !/摘要|正文|从.+到|自.+至/.test(rule.description)
  )
    return;
  const markers = source.match(/(?:从|自)[“「"]([^”」"]+)[”」"](?:到|至)[“「"]([^”」"]+)[”」"]/);
  const limit = rule.description.match(
    /(不超过|不得超过|最多|少于|至少|不少于|大于)\s*(\d+)\s*(字|页)/,
  );
  const evidence: Comparison["evidence"] = [];
  const unknown = (reason: string): Comparison => ({
    verdict: "needs_confirmation",
    reason,
    recommendation:
      "在要求来源明确起止标题、是否包含边界及统计口径；不以总字数或PDF总页数代替指定范围。",
    evidence,
  });
  if (!markers || !limit || !/不含起止|包含起止/.test(source))
    return unknown("指定范围的起止标记或包含边界尚未明确。");
  if (!materials.length) return unknown("没有指定范围材料。");
  const counts: number[] = [];
  for (const material of materials) {
    if (material.parseStatus !== "text_extracted")
      return unknown("材料未完整解析，无法统计指定范围。");
    const lines = material.segments
      .flatMap((segment) => segment.text.split(/\r?\n/).map((text) => ({ ...segment, text })))
      .map((line, order) => ({ ...line, order }));
    const starts = lines.filter((segment) => segment.text.trim() === markers[1]);
    const ends = lines.filter((segment) => segment.text.trim() === markers[2]);
    if (starts.length !== 1 || ends.length !== 1 || starts[0]!.order >= ends[0]!.order)
      return unknown("起止标题未唯一定位或顺序无效。");
    const inclusive = /包含起止/.test(source);
    const selected = lines.filter((segment) =>
      inclusive
        ? segment.order >= starts[0]!.order && segment.order <= ends[0]!.order
        : segment.order > starts[0]!.order && segment.order < ends[0]!.order,
    );
    let count: number;
    if (limit[3] === "页") {
      const pages = selected.map((segment) => segment.location.match(/(?:第\s*)?(\d+)\s*页/)?.[1]);
      if (pages.some((page) => !page) || !pages.length)
        return unknown("范围未关联可靠页码，不能换算页数。");
      count = new Set(pages).size;
    } else
      count = [
        ...selected
          .map((segment) => segment.text)
          .join("")
          .replace(/\s/gu, ""),
      ].length;
    counts.push(count);
    for (const segment of [starts[0]!, ...selected.slice(0, 1), ends[0]!])
      evidence.push({
        materialId: material.id,
        materialVersion: material.version,
        segmentIndex: segment.segmentIndex,
        location: segment.location,
        quotedText: segment.text,
      });
  }
  const value = Number(limit[2]);
  const passed = counts.every((count) =>
    ["至少", "不少于"].includes(limit[1]!)
      ? count >= value
      : limit[1] === "少于"
        ? count < value
        : limit[1] === "大于"
          ? count > value
          : count <= value,
  );
  return {
    verdict: passed ? "passed" : "failed",
    reason: `唯一标记“${markers[1]}”至“${markers[2]}”，${/包含起止/.test(source) ? "包含" : "不含"}起止段落；统计${counts.join("、")}${limit[3]}（字数为Unicode码点，忽略空白，包含标点），要求${limit[1]}${value}${limit[3]}。`,
    recommendation: passed ? "" : "调整指定范围后复检。",
    evidence,
  };
}
