import type { ReviewMaterialSummary } from "@/domain/review";

export interface MaterialInsight {
  materialId: string;
  materialVersion: number;
  location: string;
  quote: string;
  field: string;
  value: string;
}

export function backgroundSuggestions(materials: ReviewMaterialSummary[]): MaterialInsight[] {
  const suggestions: MaterialInsight[] = [];
  for (const material of materials) {
    for (const segment of material.segments) {
      for (const [field, pattern] of [
        ["collaborationScope", /(?:项目形式|合作形式|申报形式|参赛形式)\s*[：:]\s*(个人|团队)/g],
        ["projectStage", /(?:项目阶段|参赛阶段|申报阶段)\s*[：:]\s*([^\n|，。；]{1,40})/g],
        ["projectType", /(?:项目类型|项目类别|申报类别)\s*[：:]\s*([^\n|，。；]{1,40})/g],
      ] as const) {
        for (const match of segment.text.matchAll(pattern)) {
          suggestions.push({
            materialId: material.id,
            materialVersion: material.version,
            location: segment.location,
            quote: match[0],
            field,
            value:
              field === "collaborationScope"
                ? match[1] === "个人"
                  ? "individual"
                  : "team"
                : match[1]!.trim(),
          });
          if (suggestions.length >= 30) return suggestions;
        }
      }
    }
  }
  return suggestions;
}

export function sensitiveMaterialWarnings(materials: ReviewMaterialSummary[]): MaterialInsight[] {
  const warnings: MaterialInsight[] = [];
  const patterns = [
    ["身份证号码", /(?<!\d)\d{17}[\dXx](?!\d)/g],
    ["手机号码", /(?<!\d)1[3-9]\d{9}(?!\d)/g],
    ["电子邮箱", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
    [
      "可能的凭据",
      /(?:api[_-]?key|access[_-]?token|密码|密钥)\s*[=:：]\s*["']?[^\s"'，。；]{6,}/gi,
    ],
  ] as const;
  for (const material of materials)
    for (const segment of material.segments) {
      for (const [field, pattern] of patterns)
        for (const match of segment.text.matchAll(pattern)) {
          if (!match[0]) continue;
          warnings.push({
            materialId: material.id,
            materialVersion: material.version,
            location: segment.location,
            quote: "已遮盖",
            field,
            value: "可能含敏感信息，请打开原件核对并决定是否脱敏后发送模型。",
          });
          if (warnings.length >= 50) return warnings;
        }
    }
  return warnings;
}

export function similarMaterials(
  materials: ReviewMaterialSummary[],
): Array<{ left: string; right: string; similarity: number; exact: boolean }> {
  const result: Array<{ left: string; right: string; similarity: number; exact: boolean }> = [];
  const shingles = (text: string): Set<string> => {
    const normalized = text.replace(/\s/g, "").slice(0, 100_000);
    return new Set(
      Array.from({ length: Math.max(0, normalized.length - 4) }, (_, index) =>
        normalized.slice(index, index + 5),
      ),
    );
  };
  const sets = materials.map((material) => shingles(material.extractedText));
  for (let left = 0; left < materials.length; left++)
    for (let right = left + 1; right < materials.length; right++) {
      const exact = materials[left]!.sha256 === materials[right]!.sha256;
      const a = sets[left]!;
      const b = sets[right]!;
      if (!exact && (a.size < 20 || b.size < 20)) continue;
      const intersection = [...a].filter((value) => b.has(value)).length;
      const similarity = exact ? 1 : intersection / (a.size + b.size - intersection);
      if (similarity >= 0.8)
        result.push({ left: materials[left]!.id, right: materials[right]!.id, similarity, exact });
      if (result.length >= 50) return result;
    }
  return result;
}
