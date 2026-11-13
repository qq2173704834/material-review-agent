import { explicitRuleScope } from "./conflict-scope";
import type { ReviewRule } from "@/domain/review-rule";
import { extractNumericBounds } from "./numeric-constraints";

export function normalizeRules(rules: ReviewRule[]): ReviewRule[] {
  const groups = new Map<string, ReviewRule>();
  for (const rule of rules) {
    const normalized: ReviewRule = {
      ...rule,
      checkability: /原创性|美观|创新性|先进性|感染力|吸引力|创意/.test(rule.description)
        ? "assisted"
        : rule.checkability,
      numericConstraints: extractNumericBounds(rule.description),
    };
    // Merge only equivalent explicit wording with equal scope and matching; never infer semantic equivalence.
    const description = rule.description
      .normalize("NFC")
      .split(/([“「『"][^”」』"]*[”」』"])/g)
      .map((part, index) =>
        index % 2
          ? part
          : part
              .replace(/[\s。；;]+/g, "")
              .replaceAll("不得超过", "不超过")
              .replaceAll("不得少于", "不少于")
              .replace(/最多|至多/g, "不超过")
              .replace(/至少|不低于/g, "不少于")
              .replace(/必须|应当/g, "")
              .replace(
                /(\d+(?:\.\d+)?)\s*(GiB|MiB|KiB|GB|MB|KB|字节|B)/gi,
                (_, value: string, unit: string) => {
                  const scales: Record<string, number> = {
                    GIB: 1073741824,
                    MIB: 1048576,
                    KIB: 1024,
                    GB: 1000000000,
                    MB: 1000000,
                    KB: 1000,
                    B: 1,
                    字节: 1,
                  };
                  return String(Number(value) * scales[unit.toUpperCase()]!) + "B";
                },
              ),
      )
      .join("");
    const key = JSON.stringify([
      description,
      rule.target,
      rule.strength,
      rule.applicabilityScope,
      rule.applicabilityCondition,
      explicitRuleScope(rule.source.quotedText),
      [...rule.materialIds].sort(),
      rule.parameters,
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
