import { fieldCandidates, compareAlignedFields } from "./field-alignment.ts";
import type { FieldCandidate } from "./field-alignment.ts";
import type { FieldMapping, ReviewMaterialSummary, ReviewCheckEvidence } from "../domain/review";

export interface MaterialConsistencyCheck {
  field: string;
  subject: string;
  verdict: "passed" | "failed" | "needs_confirmation";
  reason: string;
  recommendation: string;
  evidence: ReviewCheckEvidence[];
  candidates: FieldCandidate[];
}
const aliases: Record<string, string> = {
  姓名: "姓名",
  名字: "姓名",
  证件号: "证件号码",
  身份证号: "证件号码",
  身份证号码: "证件号码",
  证件号码: "证件号码",
  项目名称: "项目名称",
  项目题目: "项目名称",
  单位名称: "单位名称",
  所在单位: "单位名称",
};
export function candidateIdentity(field: string): { field: string; subject: string } | undefined {
  const role = /^(申请人|考生|负责人|指导教师|导师|成员\d+)[的\s]*(.*)$/u.exec(field);
  const canonical = aliases[role?.[2] || field];
  return canonical
    ? { field: canonical, subject: role?.[1] || (canonical === "项目名称" ? "本项目" : "待确认") }
    : undefined;
}
export function materialConsistency(
  materials: ReviewMaterialSummary[],
  mappings: FieldMapping[] = [],
): MaterialConsistencyCheck[] {
  if (materials.length < 2) return [];
  const groups = new Map<
    string,
    { field: string; subject: string; candidates: FieldCandidate[] }
  >();
  for (const candidate of fieldCandidates(materials)) {
    const identity = candidateIdentity(candidate.sourceField);
    if (!identity) continue;
    const key = `${identity.subject}:${identity.field}`;
    const group = groups.get(key) || { ...identity, candidates: [] };
    group.candidates.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => new Set(group.candidates.map((item) => item.materialId)).size > 1)
    .map((group) => {
      const automatic =
        group.subject !== "待确认" &&
        group.candidates.every(
          (candidate) =>
            group.candidates.filter((other) => other.materialId === candidate.materialId).length ===
            1,
        );
      const confirmed = mappings.filter(
        (mapping) =>
          mapping.canonicalField === group.field &&
          group.candidates.some(
            (candidate) =>
              candidate.materialId === mapping.materialId &&
              candidate.sourceField === mapping.sourceField,
          ),
      );
      const selected = confirmed.length
        ? confirmed
        : automatic
          ? group.candidates.map((candidate): FieldMapping => ({
              ...candidate,
              canonicalField: group.field,
              subject: group.subject,
              note: "原文明示同一角色的唯一字段",
              confirmedAt: "",
              confirmedBy: "system",
            }))
          : [];
      const comparison = compareAlignedFields(group.field, materials, selected);
      return {
        ...group,
        ...(comparison || {
          verdict: "needs_confirmation" as const,
          reason: `${group.field}涉及多份材料，需要确认是否属于同一人或同一对象。`,
          recommendation: "仅选择属于同一对象的原文；不能确定时可以暂不处理。",
          evidence: group.candidates.map((candidate) => ({
            materialId: candidate.materialId,
            materialVersion: candidate.materialVersion,
            location: candidate.location,
            segmentIndex: candidate.segmentIndex,
            quotedText: candidate.quotedText,
          })),
        }),
      };
    });
}
