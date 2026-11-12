import type { RequirementSourceVersion } from "@/domain/review";
import type { RuleExtractionWarning } from "@/domain/review-rule";

const ATTACHMENT_REFERENCE_PATTERN =
  /(?:详见|参见|见|按照|依据).{0,12}附件|附件.{0,12}(?:另行|下载|获取|查阅|见|提供)/;

export function findMissingAttachmentWarnings(
  source: RequirementSourceVersion,
  supplementCount = 0,
): RuleExtractionWarning[] {
  return source.segments.flatMap((segment) => {
    if (!ATTACHMENT_REFERENCE_PATTERN.test(segment.text)) return [];
    const quotedText = segment.text.match(ATTACHMENT_REFERENCE_PATTERN)?.[0];
    if (!quotedText) return [];
    const localOffset = segment.text.indexOf(quotedText);
    const startOffset = segment.startOffset + localOffset;
    return [
      {
        code: "attachment_dependency" as const,
        message:
          supplementCount === 0
            ? "通知提及相关附件，但任务尚未导入独立附件来源；要求可能不完整，请获取并核对附件后再审查。"
            : `通知提及相关附件；任务已有 ${supplementCount} 个补充来源，请人工确认其中包含该引用附件。`,
        source: {
          sourceId: source.id,
          sourceVersion: source.version,
          paragraphIndex: segment.paragraphIndex,
          quotedText,
          startOffset,
          endOffset: startOffset + quotedText.length,
        },
      },
    ];
  });
}
