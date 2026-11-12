import { randomUUID } from "node:crypto";

import type {
  ReviewRule,
  RuleExtractionInput,
  RuleExtractionWarning,
  RuleStrength,
} from "@/domain/review-rule";

const RULE_HINT_PATTERN =
  /必须|须|应(?:当)?(?:提交|提供|上传|符合|达到|满足|完成|为|在)|需要|提交|提供|上传|格式|页|字|大小|不超过|不得|至少|至多|数量|命名|文件名|禁止|建议|推荐|可选|可以/;
const DETERMINISTIC_PATTERN =
  /格式|大小|不超过|至少|至多|页数|页|字数|字符|数量|份|个|命名|文件|PDF|DOCX|TXT|XLSX|CSV|JPG|PNG/i;
const TEAM_SCOPE_PATTERN = /团队|小组|成员|多人/;
const INDIVIDUAL_SCOPE_PATTERN = /个人|单人/;
const CONDITIONAL_PATTERN = /如|若|如果|仅限|适用于|针对|当.*时|阶段|类别/;

interface TextFragment {
  text: string;
  startOffset: number;
  endOffset: number;
  paragraphIndex: number;
}

function splitIntoFragments(noticeText: string): TextFragment[] {
  const fragments: TextFragment[] = [];
  let paragraphIndex = 0;

  for (const lineMatch of noticeText.matchAll(/[^\r\n]+/g)) {
    const line = lineMatch[0];
    const lineStart = lineMatch.index;
    const parts = line.split(/[；;。，,]/g);
    let searchFrom = 0;

    for (const part of parts) {
      const partStart = line.indexOf(part, searchFrom);
      searchFrom = partStart + part.length;
      const leadingWhitespace = part.search(/\S|$/);
      const trailingWhitespace = part.search(/\s*$/);
      const trimmed = part.trim();
      if (!trimmed) continue;

      const startOffset = lineStart + partStart + leadingWhitespace;
      const endOffset = lineStart + partStart + trailingWhitespace;
      fragments.push({ text: trimmed, startOffset, endOffset, paragraphIndex });
    }
    if (line.trim()) paragraphIndex += 1;
  }

  return fragments;
}

function detectStrength(text: string): RuleStrength {
  if (/可选|可以选择|自愿/.test(text)) return "optional";
  if (/建议|推荐|宜/.test(text)) return "recommended";
  if (
    /必须|(?:^|[，,：:\s])须(?:在|提交|提供|上传|满足|符合|完成)?|应(?:当)?(?:提交|提供|上传|符合|达到|满足|完成|为|在)|需要(?:提交|提供|上传)|不得|禁止|提交|提供|上传|不超过|至少|至多|最多|不少于|恰好|正好/.test(
      text,
    )
  ) {
    return "required";
  }
  return "unknown";
}

function detectScope(text: string): {
  scope: "individual" | "team" | "unknown";
  condition: string;
} {
  if (TEAM_SCOPE_PATTERN.test(text)) return { scope: "team", condition: text };
  if (INDIVIDUAL_SCOPE_PATTERN.test(text)) return { scope: "individual", condition: text };
  if (CONDITIONAL_PATTERN.test(text)) return { scope: "unknown", condition: text };
  return { scope: "unknown", condition: "" };
}

function detectTarget(text: string): string {
  const target = text.match(/(?:PDF|DOCX|TXT|XLSX|CSV|JPG|PNG|文件|材料|申请书|说明|证明)/i)?.[0];
  return target ?? "通知要求";
}

function detectParameters(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?\s*(?:MB|GB|页|字|字符|份|个|%|天|年)/gi)].map(
    (match) => match[0],
  );
}

function createWarning(
  code: RuleExtractionWarning["code"],
  message: string,
  source: ReviewRule["source"],
): RuleExtractionWarning {
  return { code, message, source };
}

export function extractMockRules(input: RuleExtractionInput): {
  rules: ReviewRule[];
  warnings: RuleExtractionWarning[];
} {
  const rules: ReviewRule[] = [];
  const warnings: RuleExtractionWarning[] = [];

  for (const fragment of splitIntoFragments(input.noticeText)) {
    if (!RULE_HINT_PATTERN.test(fragment.text)) continue;

    const strength = detectStrength(fragment.text);
    const scope = detectScope(fragment.text);
    const source = {
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      displayName: input.sourceDisplayName ?? "主通知",
      paragraphIndex: fragment.paragraphIndex,
      quotedText: fragment.text,
      startOffset: fragment.startOffset,
      endOffset: fragment.endOffset,
    };
    const uncertainty =
      strength === "unknown" ? "原文未明确必须、建议或可选强度，需要人工确认。" : "";
    const scopeUncertainty =
      scope.condition && scope.scope === "unknown"
        ? "适用条件存在，但当前无法确定个人或团队范围。"
        : "";
    const checkability = DETERMINISTIC_PATTERN.test(fragment.text) ? "deterministic" : "assisted";
    const rule: ReviewRule = {
      id: randomUUID(),
      code: `R-${String(rules.length + 1).padStart(3, "0")}`,
      description: fragment.text,
      target: detectTarget(fragment.text),
      strength,
      applicabilityScope: scope.scope,
      applicabilityCondition: scope.condition,
      parameters: detectParameters(fragment.text),
      materialIds: [],
      checkability,
      generationMethod: "mock",
      uncertainty: [uncertainty, scopeUncertainty].filter(Boolean).join(" "),
      source,
    };
    rules.push(rule);

    if (strength === "unknown") {
      warnings.push(createWarning("unknown_strength", uncertainty, source));
    }
    if (scopeUncertainty) {
      warnings.push(createWarning("unknown_scope", scopeUncertainty, source));
    }
    if (checkability === "assisted") {
      warnings.push(
        createWarning(
          "content_requires_evidence",
          "该要求需要材料内容证据，当前只生成规则草稿。",
          source,
        ),
      );
    }
  }

  if (rules.length === 0) {
    warnings.push({
      code: "unsupported_input",
      message: "通知中没有识别到带有常见要求提示的句段；不能据此推断没有提交要求。",
    });
  }

  return { rules, warnings };
}
