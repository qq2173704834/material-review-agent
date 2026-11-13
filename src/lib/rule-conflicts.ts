import type { ReviewRule, RuleExtractionWarning } from "@/domain/review-rule";
import { findGregorianDates } from "@/lib/calendar-dates";
import { extractNumericBounds, incompatibleBounds } from "./numeric-constraints";

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
  for (const date of findGregorianDates(description)) {
    const prefix = description.slice(Math.max(0, date.startIndex - 16), date.startIndex);
    const suffix = description.slice(date.endIndex, date.endIndex + 8);
    if (
      !/(?:截止|提交|报名|申报|期限|最晚|不晚于)/.test(prefix) &&
      !/^(?:前提交|前截止|截止)/.test(suffix)
    ) {
      continue;
    }
    deadlines.push({ timestamp: date.timestamp });
  }

  return deadlines;
}

function exclusiveFormats(description: string, target: string): ExclusiveFormat[] {
  const materialTargets = [...description.matchAll(MATERIAL_TARGET_PATTERN)].map(
    (match) => match[0],
  );
  const materialTarget = materialTargets[0] ?? target;
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
      if (
        firstRule.applicabilityScope !== "unknown" &&
        secondRule.applicabilityScope !== "unknown" &&
        firstRule.applicabilityScope !== secondRule.applicabilityScope
      )
        continue;
      const firstFormats = exclusiveFormats(firstRule.description, firstRule.target);
      const secondFormats = exclusiveFormats(secondRule.description, secondRule.target);
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
      const units: Record<string, number> = {
        B: 1,
        字节: 1,
        KB: 1000,
        KIB: 1024,
        MB: 1_000_000,
        MIB: 1_048_576,
        GB: 1_000_000_000,
        GIB: 1_073_741_824,
      };
      const firstBounds = extractNumericBounds(firstRule.description).map((bound) => ({
        ...bound,
        value: bound.value * (units[bound.unit] ?? 1),
        unit: bound.unit in units ? "bytes" : bound.unit,
      }));
      const secondBounds = extractNumericBounds(secondRule.description).map((bound) => ({
        ...bound,
        value: bound.value * (units[bound.unit] ?? 1),
        unit: bound.unit in units ? "bytes" : bound.unit,
      }));
      const extendedConflict = firstBounds.some((first) =>
        secondBounds.some(
          (second) => first.unit === second.unit && incompatibleBounds([first, second]),
        ),
      );
      const conflict = numericConflict || extendedConflict || deadlineConflict || formatConflict;
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
