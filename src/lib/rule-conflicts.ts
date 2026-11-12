import type { ReviewRule, RuleExtractionWarning } from "@/domain/review-rule";

interface NumericConstraint {
  unit: string;
  lower?: number;
  upper?: number;
}

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

export function findRuleConflicts(rules: ReviewRule[]): RuleExtractionWarning[] {
  const warnings: RuleExtractionWarning[] = [];
  for (let firstIndex = 0; firstIndex < rules.length; firstIndex += 1) {
    const firstRule = rules[firstIndex];
    if (!firstRule) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < rules.length; secondIndex += 1) {
      const secondRule = rules[secondIndex];
      if (!secondRule || firstRule.target !== secondRule.target) continue;
      const firstConstraints = numericConstraints(firstRule.description);
      const secondConstraints = numericConstraints(secondRule.description);
      const conflict = firstConstraints.some((first) =>
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
      if (!conflict) continue;
      warnings.push({
        code: "conflicting_constraints",
        message: `检测到同一目标的数值边界相互矛盾，请核对两处原文：“${firstRule.source.quotedText}”；“${secondRule.source.quotedText}”。系统不会自行选择其中一项。`,
        source: firstRule.source,
      });
    }
  }
  return warnings;
}
