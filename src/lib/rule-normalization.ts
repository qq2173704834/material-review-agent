import type { ReviewRule } from "@/domain/review-rule";
import { extractNumericBounds } from "./numeric-constraints";

export function normalizeRules(rules: ReviewRule[]): ReviewRule[] {
  const groups = new Map<string, ReviewRule>();
  for (const rule of rules) {
    const normalized = { ...rule, numericConstraints: extractNumericBounds(rule.description) };
    // Merge only equivalent explicit wording with equal scope and matching; never infer semantic equivalence.
    const description = rule.description
      .normalize("NFC")
      .replace(/[\s。；;]+/g, "")
      .replaceAll("不得超过", "不超过")
      .replaceAll("不得少于", "不少于");
    const key = JSON.stringify([
      description,
      rule.target,
      rule.strength,
      rule.applicabilityScope,
      rule.applicabilityCondition,
      rule.materialIds,
      rule.checkability,
      rule.uncertainty,
    ]);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, normalized);
      continue;
    }
    const sources = [
      existing.source,
      ...(existing.additionalSources ?? []),
      rule.source,
      ...(rule.additionalSources ?? []),
    ];
    const unique = [
      ...new Map(
        sources.map((source) => [
          JSON.stringify([
            source.sourceId,
            source.sourceVersion,
            source.startOffset,
            source.endOffset,
          ]),
          source,
        ]),
      ).values(),
    ];
    // Keep an independent rule when the citation limit is reached instead of losing its origin.
    if (unique.length > 51) groups.set(`${key}:${rule.id}`, normalized);
    else existing.additionalSources = unique.slice(1);
  }
  return [...groups.values()].map((rule, index) => ({
    ...rule,
    code: `R-${String(index + 1).padStart(3, "0")}`,
  }));
}
