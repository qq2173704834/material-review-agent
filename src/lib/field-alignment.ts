import type { FieldMapping, ReviewMaterialSummary, ReviewCheckEvidence } from "../domain/review";

export interface FieldCandidate {
  materialId: string;
  materialVersion: number;
  segmentIndex: number;
  sourceField: string;
  rawValue: string;
  location: string;
  quotedText: string;
}

export function fieldCandidates(materials: ReviewMaterialSummary[]): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  for (const material of materials)
    for (const segment of material.segments) {
      for (const match of segment.text.matchAll(
        /(?:^|[\n|;；])\s*([^\n|:：;；]{1,40})\s*[:：]\s*([^\n|;；]{1,200})/gu,
      )) {
        candidates.push({
          materialId: material.id,
          materialVersion: material.version,
          segmentIndex: segment.segmentIndex,
          sourceField: match[1]!.trim(),
          rawValue: match[2]!.trim(),
          location: segment.location,
          quotedText: match[0].trim().replace(/^[|;；]\s*/u, ""),
        });
        if (candidates.length >= 5000) return candidates;
      }
    }
  return candidates;
}

export function normalizeFieldValue(raw: string): { value: string; method: string } {
  const value = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  const date = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/u.exec(value);
  if (date) {
    const year = Number(date[1]),
      month = Number(date[2]),
      day = Number(date[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    )
      return { value: parsed.toISOString().slice(0, 10), method: "NFC、空白及有效公历日期规范化" };
  }
  return { value, method: "NFC及连续空白规范化（不合并简称或遮挡值）" };
}

export function compareAlignedFields(
  field: string,
  materials: ReviewMaterialSummary[],
  mappings: FieldMapping[],
):
  | {
      verdict: "passed" | "failed" | "needs_confirmation";
      reason: string;
      recommendation: string;
      evidence: ReviewCheckEvidence[];
    }
  | undefined {
  const selected = mappings.filter(
    (mapping) =>
      mapping.canonicalField === field &&
      materials.some((material) => material.id === mapping.materialId),
  );
  if (!selected.length) return undefined;
  const evidence: ReviewCheckEvidence[] = [];
  const uncertain = (reason: string): NonNullable<ReturnType<typeof compareAlignedFields>> => ({
    verdict: "needs_confirmation" as const,
    reason,
    recommendation: "请在本项问题中核对是否属于同一对象，以及原文是否完整。",
    evidence,
  });
  const candidates = fieldCandidates(materials);
  for (const mapping of selected) {
    const candidate = candidates.find(
      (item) =>
        item.materialId === mapping.materialId &&
        item.materialVersion === mapping.materialVersion &&
        item.segmentIndex === mapping.segmentIndex &&
        item.sourceField === mapping.sourceField &&
        item.rawValue === mapping.rawValue,
    );
    if (!candidate) return uncertain("字段映射引用的材料版本或原文已变化，旧映射需要重新确认。");
    const region = materials
      .find((item) => item.id === mapping.materialId)
      ?.segments.find((item) => item.segmentIndex === mapping.segmentIndex)?.region;
    if (region && region.status !== "confirmed")
      return uncertain("图像关键字段所在区域尚未核对，OCR平均分不能代替关键字段确认。");
    evidence.push({
      region,
      materialId: mapping.materialId,
      materialVersion: mapping.materialVersion,
      segmentIndex: mapping.segmentIndex,
      quotedText: candidate.quotedText,
      location: `${candidate.location} · 主体：${mapping.subject}`,
    });
  }
  const groups = Map.groupBy(selected, (mapping) => mapping.subject);
  const failures: string[] = [];
  for (const [subject, group] of groups) {
    if (
      materials.length < 2 ||
      materials.some(
        (material) => group.filter((item) => item.materialId === material.id).length !== 1,
      )
    )
      return uncertain(`主体“${subject}”缺少材料映射或同份材料出现多值；不能与其他主体拼接比较。`);
    if (group.some((item) => /[*＊×?？□遮挡隐去]|未填|未知|不详/u.test(item.rawValue)))
      return uncertain(`主体“${subject}”存在遮挡或未确认值。`);
    if (new Set(group.map((item) => normalizeFieldValue(item.rawValue).value)).size > 1)
      failures.push(
        `${subject}：${group.map((item) => `${item.sourceField}=${item.rawValue}`).join("；")}`,
      );
  }
  return failures.length
    ? {
        verdict: "failed",
        reason: `按已确认主体比较发现差异：${failures.join("；")}。原值保留，仅规范化Unicode、空白和明确有效日期。`,
        recommendation: "核对双方原件并修订材料或映射。",
        evidence,
      }
    : {
        verdict: "passed",
        reason: `按已确认映射分别比较${groups.size}个主体的“${field}”一致；仅规范化Unicode、空白和明确有效日期。`,
        recommendation: "",
        evidence,
      };
}
