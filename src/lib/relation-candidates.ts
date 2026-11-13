import { explicitRuleScope, compareRuleScopes } from "./conflict-scope.ts";
import type { ReviewRule, RuleExtractionWarning } from "../domain/review-rule";
import type { RequirementSourceVersion } from "../domain/review";
interface RelationCitation {
  sourceId: string;
  paragraphIndex: number;
  quotedText: string;
}
export interface RelationCandidate {
  first: RelationCitation;
  second: RelationCitation;
  kind: "exception" | "alternative" | "replacement" | "implicit_conflict";
  reason: string;
}
export function relationWarnings(
  relations: RelationCandidate[],
  sources: RequirementSourceVersion[],
  rules: ReviewRule[],
): RuleExtractionWarning[] {
  return relations.flatMap((relation): RuleExtractionWarning[] => {
    const related = [relation.first, relation.second].map((citation) => {
      const source = sources.find((item) => item.id === citation.sourceId),
        segment = source?.segments.find((item) => item.paragraphIndex === citation.paragraphIndex);
      if (!source || !segment || !segment.text.includes(citation.quotedText))
        throw new Error("关系候选引用不足。");
      const rule = rules.find(
        (item) =>
          item.source.sourceId === source.id &&
          item.source.paragraphIndex === citation.paragraphIndex &&
          item.source.quotedText.includes(citation.quotedText),
      );
      if (!rule) throw new Error("关系候选没有对应的独立条款。");
      return rule;
    });
    if (related[0]!.id === related[1]!.id) throw new Error("关系候选必须有两个不同条款。");
    if (
      compareRuleScopes(
        explicitRuleScope(related[0]!.applicabilityCondition + ";" + related[0]!.source.quotedText),
        explicitRuleScope(related[1]!.applicabilityCondition + ";" + related[1]!.source.quotedText),
      ) === "different"
    )
      return [];
    return [
      {
        code: "conflicting_constraints",
        message: `模型待核对关系候选（${relation.kind}）：${relation.reason}`.slice(0, 500),
        source: related[0]!.source,
        sources: related.map((rule) => rule.source),
        relatedRuleIds: related.map((rule) => rule.id),
      },
    ];
  });
}
