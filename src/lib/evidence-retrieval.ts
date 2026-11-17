import type { ReviewMaterialSummary, ReviewCheckResult } from "@/domain/review";
import type { ReviewRule } from "@/domain/review-rule";

export interface RetrievedSnippet {
  materialId: string;
  segmentIndex: number;
  text: string;
  chunkStart: number;
}

/**
 * 为单条规则选择材料片段，按主查询、相关词和相邻上下文分配检索预算。
 * 返回的段落编号和块起点沿用材料坐标，coverage 记录本轮实际覆盖范围。
 */
export function retrieveEvidence(
  rule: ReviewRule,
  materials: ReviewMaterialSummary[],
): {
  snippets: RetrievedSnippet[];
  coverage: NonNullable<ReviewCheckResult["coverage"]>;
} {
  const terms = [
    ...new Set(
      (`${rule.target} ${rule.description}`.match(/[\p{L}\p{N}]{2,}/gu) ?? []).flatMap((word) => [
        word,
        ...Array.from({ length: Math.max(0, word.length - 1) }, (_, index) =>
          word.slice(index, index + 2),
        ),
      ]),
    ),
  ];
  const expansions: Record<string, string[]> = {
    预算: ["金额", "费用", "明细", "合计"],
    测试: ["实验", "样本", "指标", "验证"],
    团队: ["成员", "分工", "负责人"],
    实施: ["技术路线", "方法", "步骤"],
    演示: ["操作", "运行", "展示"],
    依赖: ["dependencies", "requirements", "安装"],
    配置: ["environment", "环境变量", ".env"],
  };
  const secondaryTerms = [
    ...new Set([
      ...(rule.parameters ?? []),
      ...Object.entries(expansions)
        .filter(([keyword]) => rule.description.includes(keyword))
        .flatMap(([, values]) => values),
    ]),
  ]
    .filter((term) => term.length > 1)
    .slice(0, 80);
  const segments = materials.flatMap((material) =>
    material.segments.map((segment) => ({ ...segment, materialId: material.id })),
  );
  const chunks = segments.flatMap((segment) => {
    const result: Array<RetrievedSnippet & { score: number; key: string }> = [];
    // 每块最多 2,000 字符、步长 1,800，保留重叠以覆盖跨块边界的内容。
    for (let start = 0; start < segment.text.length; start += 1800) {
      const text = segment.text.slice(start, start + 2000);
      result.push({
        materialId: segment.materialId,
        segmentIndex: segment.segmentIndex,
        text,
        chunkStart: start,
        key: `${segment.materialId}:${segment.segmentIndex}:${start}`,
        score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0),
      });
    }
    return result;
  });
  const ranked = [...chunks].sort((a, b) => b.score - a.score);
  const selected = new Map<string, RetrievedSnippet>();
  let remaining = 24_000;
  function add(chunk: (typeof chunks)[number] | undefined): void {
    if (!chunk || selected.has(chunk.key) || selected.size >= 60 || !remaining) return;
    const text = chunk.text.slice(0, remaining);
    selected.set(chunk.key, {
      materialId: chunk.materialId,
      segmentIndex: chunk.segmentIndex,
      chunkStart: chunk.chunkStart,
      text,
    });
    remaining -= text.length;
  }
  // 限制主查询先占用的预算，为相关词扩展和相邻上下文留出空间。
  for (const chunk of ranked) {
    if (remaining <= 18_000) break;
    add(chunk);
  }
  // 用规则参数与预设相关词补充候选；先从每份材料取候选，再补入其余高分块。
  const expanded = chunks
    .map((chunk) => ({
      ...chunk,
      secondaryScore: secondaryTerms.reduce(
        (score, term) => score + (chunk.text.includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((chunk) => chunk.secondaryScore > 0)
    .sort((a, b) => b.secondaryScore - a.secondaryScore);
  for (const material of materials) {
    if (remaining <= 12_000) break;
    add(expanded.find((chunk) => chunk.materialId === material.id));
  }
  for (const chunk of expanded) {
    if (remaining <= 12_000) break;
    add(chunk);
  }
  for (const chunk of [...selected.values()]) {
    const index = chunks.findIndex(
      (candidate) =>
        candidate.materialId === chunk.materialId &&
        candidate.segmentIndex === chunk.segmentIndex &&
        candidate.chunkStart === chunk.chunkStart,
    );
    // 相邻块只在同一材料内扩展，保留选中内容前后的语境。
    for (const neighbor of [chunks[index - 1], chunks[index + 1]]) {
      if (neighbor?.materialId === chunk.materialId) add(neighbor);
    }
  }
  for (const chunk of ranked) add(chunk);
  const snippets = [...selected.values()];
  return {
    snippets,
    coverage: {
      examinedSegments: new Set(
        snippets.map((snippet) => `${snippet.materialId}:${snippet.segmentIndex}`),
      ).size,
      totalSegments: segments.length,
      // 完整覆盖同时要求解析成功、每个候选块均被完整纳入；仅命中段落数不足以判定。
      isComplete:
        materials.every((material) => material.parseStatus === "text_extracted") &&
        chunks.every((chunk) => selected.get(chunk.key)?.text.length === chunk.text.length),
    },
  };
}
