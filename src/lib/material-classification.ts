import type { MaterialContentSegment, ReviewMaterialSummary } from "@/domain/review";

export interface MaterialClassification {
  label: string;
  method: "content" | "manual";
  quote: string;
  location: string;
}
const knownKinds = [
  "申请书",
  "申报书",
  "项目说明",
  "实施说明",
  "技术文档",
  "授权证明",
  "预算说明",
  "预算表",
  "测试报告",
  "分工表",
];

export function classifyMaterial(
  segments: MaterialContentSegment[],
): MaterialClassification | undefined {
  const explicit = segments.flatMap((segment) =>
    [...segment.text.matchAll(/(?:材料类型|文档类型)\s*[：:]\s*([^\n|，。；]{1,80})/g)].map(
      (match) => ({
        label: match[1]!.trim(),
        method: "content" as const,
        quote: match[0],
        location: segment.location,
      }),
    ),
  );
  if (new Set(explicit.map((candidate) => candidate.label)).size === 1) return explicit[0];
  if (explicit.length) return undefined;
  const candidates = knownKinds.flatMap((label) => {
    const segment = segments.find((item) => item.text.includes(label));
    if (!segment) return [];
    const index = segment.text.indexOf(label);
    return [
      {
        label,
        method: "content" as const,
        quote: segment.text.slice(Math.max(0, index - 30), index + 170),
        location: segment.location,
      },
    ];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function targetCandidates(
  target: string,
  materials: ReviewMaterialSummary[],
): Array<{ materialId: string; quote: string; location: string }> {
  if (
    !target.trim() ||
    /^(通知要求|全部材料|所有材料|全部文件|所有文件|文件|材料|PDF|TXT|DOCX)$/i.test(target)
  )
    return [];
  return materials.flatMap((material) => {
    const segment = material.segments.find((item) => item.text.includes(target));
    if (!segment) return [];
    const index = segment.text.indexOf(target);
    return [
      {
        materialId: material.id,
        quote: segment.text.slice(Math.max(0, index - 20), index + 180),
        location: segment.location,
      },
    ];
  });
}
