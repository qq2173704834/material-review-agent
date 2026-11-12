import type { ReviewRule, RuleExtractionWarning } from "@/domain/review-rule";

interface NumericConstraint {
  unit: string;
  lower?: number;
  upper?: number;
}

interface ExplicitDeadline {
  timestamp: number;
}

interface ExclusiveFormat {
  materialTarget: string;
  format: string;
}

const MATERIAL_TARGET_PATTERN = /项目计划书|项目说明|申请书|申报书|预算表|作品集|简历|证明材料/g;

function numericConstraints(description: string): NumericConstraint[] {
  const constraints: NumericConstraint[] = [];
  const patterns: Array<{ expression: RegExp; bound: "lower" | "upper" }> = [
    {
      expression: /(?:至少|不少于|不低于|≥|>=)\s*(\d+(?:\.\d+)?)\s*(页|份|个|件|字|字符)/g,
      bound: "lower",
    },
    {
      expression: /(?:最多|至多|不超过|不得超过|≤|<=)\s*(\d+(?:\.\d+)?)\s*(页|份|个|件|字|字符)/g,
      bound: "upper",
    },
  ];
  for (const { expression, bound } of patterns) {
    for (const match of description.matchAll(expression)) {
      const value = Number(match[1]);
      const unit = match[2];
      if (!Number.isFinite(value) || !unit) continue;
      constraints.push({ unit, [bound]: value });
    }
  }
  return constraints;
}

function explicitDeadlines(description: string): ExplicitDeadline[] {
  const deadlines: ExplicitDeadline[] = [];
  const datePattern =
    /(?:(\d{4})年(\d{1,2})月(\d{1,2})日?|\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b)/g;

  for (const match of description.matchAll(datePattern)) {
    const dateIndex = match.index;
    const dateText = match[0];
    if (dateIndex === undefined || !dateText) continue;
    const prefix = description.slice(Math.max(0, dateIndex - 16), dateIndex);
    const suffix = description.slice(dateIndex + dateText.length, dateIndex + dateText.length + 8);
    if (
      !/(?:截止|提交|报名|申报|期限|最晚|不晚于)/.test(prefix) &&
      !/^(?:前提交|前截止|截止)/.test(suffix)
    ) {
      continue;
    }

    const year = Number(match[1] ?? match[4]);
    const month = Number(match[2] ?? match[5]);
    const day = Number(match[3] ?? match[6]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      continue;
    }
    deadlines.push({ timestamp: date.getTime() });
  }

  return deadlines;
}

function exclusiveFormats(description: string): ExclusiveFormat[] {
  const materialTargets = [...description.matchAll(MATERIAL_TARGET_PATTERN)].map(
    (match) => match[0],
  );
  const materialTarget = materialTargets[0];
  if (!materialTarget) return [];

  const formats: ExclusiveFormat[] = [];
  const formatPattern =
    /(?:仅限|只能|仅可|仅采用|只能采用|仅为|只能为|仅提交为|只能提交为)\s*(PDF|DOCX|TXT|XLSX|CSV|JPG|PNG)\s*格式?/gi;
  for (const match of description.matchAll(formatPattern)) {
    const format = match[1]?.toUpperCase();
    if (format) formats.push({ materialTarget, format });
  }
  return formats;
}

export function findRuleConflicts(rules: ReviewRule[]): RuleExtractionWarning[] {
  const warnings: RuleExtractionWarning[] = [];
  for (let firstIndex = 0; firstIndex < rules.length; firstIndex += 1) {
    const firstRule = rules[firstIndex];
    if (!firstRule) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < rules.length; secondIndex += 1) {
      const secondRule = rules[secondIndex];
      if (!secondRule) continue;
      const firstFormats = exclusiveFormats(firstRule.description);
      const secondFormats = exclusiveFormats(secondRule.description);
      const formatScopeMatch = firstFormats.some((first) =>
        secondFormats.some((second) => first.materialTarget === second.materialTarget),
      );
      if (firstRule.target !== secondRule.target && !formatScopeMatch) continue;
      const firstConstraints = numericConstraints(firstRule.description);
      const secondConstraints = numericConstraints(secondRule.description);
      const numericConflict = firstConstraints.some((first) =>
        secondConstraints.some(
          (second) =>
            first.unit === second.unit &&
            ((first.lower !== undefined &&
              second.upper !== undefined &&
              first.lower > second.upper) ||
              (second.lower !== undefined &&
                first.upper !== undefined &&
                second.lower > first.upper)),
        ),
      );
      const firstDeadlines = explicitDeadlines(firstRule.description);
      const secondDeadlines = explicitDeadlines(secondRule.description);
      const deadlineConflict = firstDeadlines.some((first) =>
        secondDeadlines.some((second) => first.timestamp !== second.timestamp),
      );
      const formatConflict = firstFormats.some((first) =>
        secondFormats.some(
          (second) =>
            first.materialTarget === second.materialTarget && first.format !== second.format,
        ),
      );
      const conflict = numericConflict || deadlineConflict || formatConflict;
      if (!conflict) continue;
      warnings.push({
        code: "conflicting_constraints",
        message: `对“${firstRule.target}”的要求相互矛盾，尚未指定采用依据。`,
        source: firstRule.source,
        sources: [firstRule.source, secondRule.source],
        relatedRuleIds: [firstRule.id, secondRule.id],
      });
    }
  }
  return warnings;
}
