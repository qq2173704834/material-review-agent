import type {
  ReviewCheckEvidence,
  ReviewCheckResult,
  ReviewExecution,
  ReviewMaterialSummary,
  ReviewTaskBackground,
} from "@/domain/review";
import type { ReviewRule, ReviewRuleSet } from "@/domain/review-rule";

const EXTENSION_NAMES: Record<string, string> = {
  PDF: "pdf",
  DOCX: "docx",
  TXT: "txt",
  XLSX: "xlsx",
  CSV: "csv",
  JPG: "jpg",
  JPEG: "jpg",
  PNG: "png",
};

function materialEvidence(material: ReviewMaterialSummary): ReviewCheckEvidence {
  return {
    materialId: material.id,
    materialVersion: material.version,
    quotedText:
      material.extractedText.slice(0, 240) ||
      `${material.originalFileName}（${material.fileSizeBytes} 字节）`,
    location: material.segments[0]?.location ?? "文件属性",
  };
}

export function applicableRule(
  rule: ReviewRule,
  background: ReviewTaskBackground,
): boolean | undefined {
  if (rule.applicabilityScope === "team" && background.collaborationScope === "individual")
    return false;
  if (rule.applicabilityScope === "individual" && background.collaborationScope === "team")
    return false;
  if (
    rule.applicabilityCondition &&
    /如|若|阶段|类别|初赛|复赛|决赛|申报|结项/.test(rule.applicabilityCondition)
  )
    return undefined;
  if (rule.applicabilityScope !== "unknown" && background.collaborationScope !== "unknown")
    return true;
  if (rule.applicabilityCondition) return undefined;
  return true;
}

function compareRule(
  rule: ReviewRule,
  materials: ReviewMaterialSummary[],
): Pick<ReviewCheckResult, "verdict" | "reason" | "recommendation" | "evidence"> {
  const description = rule.description;
  const evidence = materials.map(materialEvidence);
  const characterLimit = description.match(
    /(?:不超过|至多|最多|≤|<=)\s*(\d+)\s*(?:个)?(?:汉字|字|字符)|(?:不少于|至少|≥|>=)\s*(\d+)\s*(?:个)?(?:汉字|字|字符)/,
  );
  if (characterLimit) {
    const maximum = characterLimit[1] ? Number(characterLimit[1]) : null;
    const minimum = characterLimit[2] ? Number(characterLimit[2]) : null;
    if (!materials.length)
      return {
        verdict: "needs_confirmation",
        reason: "尚无材料可进行全文字数统计。",
        recommendation: "上传可提取文本的材料后重新检查。",
        evidence: [],
      };
    const unavailable = materials.filter((material) => material.parseStatus !== "text_extracted");
    if (unavailable.length)
      return {
        verdict: "unable_to_check",
        reason:
          "以下材料未能完整提取文本，无法可靠统计全文字符数：" +
          unavailable.map((material) => material.originalFileName).join("、") +
          "。",
        recommendation: "替换为可完整解析的材料后重新检查。",
        evidence: unavailable.map(materialEvidence),
      };
    const counts = materials.map((material) => ({
      material,
      count: Array.from(material.extractedText.replace(/\s/gu, "")).length,
    }));
    const outside = counts.filter(
      ({ count }) => (maximum !== null && count > maximum) || (minimum !== null && count < minimum),
    );
    const bound =
      maximum !== null ? "不超过 " + maximum + " 字" : "不少于 " + (minimum ?? 0) + " 字";
    return outside.length
      ? {
          verdict: "failed",
          reason:
            outside
              .map(({ material, count }) => material.originalFileName + " 为 " + count + " 字")
              .join("、") +
            "，不符合全文" +
            bound +
            "要求。",
          recommendation: "调整全文长度后重新上传。统计范围为已提取全文文本，空白字符不计。",
          evidence: outside.map(({ material }) => materialEvidence(material)),
        }
      : {
          verdict: "passed",
          reason:
            counts
              .map(({ material, count }) => material.originalFileName + " 为 " + count + " 字")
              .join("、") +
            "，符合全文" +
            bound +
            "要求。",
          recommendation: "",
          evidence,
        };
  }
  const extensions = [...description.matchAll(/\b(PDF|DOCX|TXT|XLSX|CSV|JPG|JPEG|PNG)\b/gi)]
    .map((match) => EXTENSION_NAMES[(match[1] ?? "").toUpperCase()])
    .filter((extension): extension is string => Boolean(extension));

  if (extensions.length && /格式|后缀|扩展名/.test(description)) {
    if (!materials.length) {
      return {
        verdict: "failed",
        reason: `尚未上传要求的 ${[...new Set(extensions)].join("、")} 材料。`,
        recommendation: "上传符合通知格式要求的材料。",
        evidence: [],
      };
    }
    const unverified = materials.filter((material) => material.parseStatus === "failed");
    if (unverified.length) {
      return {
        verdict: "unable_to_check",
        reason: `以下材料未通过文件类型或内容校验，不能只依据扩展名判定格式：${unverified.map((material) => material.originalFileName).join("、")}。`,
        recommendation: "替换为有效文件后重新检查。",
        evidence: unverified.map(materialEvidence),
      };
    }
    const invalid = materials.filter(
      (material) => !extensions.includes(material.extension.toLowerCase()),
    );
    return invalid.length
      ? {
          verdict: "failed",
          reason: `以下材料格式不符合要求：${invalid.map((material) => `${material.originalFileName}（${material.extension.toUpperCase()}）`).join("、")}。`,
          recommendation: `请提交 ${[...new Set(extensions)].join("、")} 格式。`,
          evidence: invalid.map(materialEvidence),
        }
      : {
          verdict: "passed",
          reason: `已核对 ${materials.length} 份材料的文件类型，均符合 ${[...new Set(extensions)].join("、")}。`,
          recommendation: "",
          evidence,
        };
  }

  const sizeMatch = description.match(
    /(?:不超过|至多|最大|≤|<=)\s*(\d+(?:\.\d+)?)\s*(字节|B|KB|KiB|MB|MiB|GB|GiB)/i,
  );
  if (sizeMatch) {
    const units: Record<string, number> = {
      字节: 1,
      B: 1,
      KB: 1000,
      KIB: 1024,
      MB: 1_000_000,
      MIB: 1_048_576,
      GB: 1_000_000_000,
      GIB: 1_073_741_824,
    };
    const unit = sizeMatch[2] ?? "";
    const maximum = Number(sizeMatch[1]) * (units[unit.toUpperCase()] ?? 1);
    const oversized = materials.filter((material) => material.fileSizeBytes > maximum);
    if (!materials.length)
      return {
        verdict: "needs_confirmation",
        reason: "尚无材料可进行文件大小比较。",
        recommendation: "上传材料后重新检查。",
        evidence: [],
      };
    return oversized.length
      ? {
          verdict: "failed",
          reason: `超过单文件上限 ${sizeMatch[1]} ${sizeMatch[2]}：${oversized.map((material) => `${material.originalFileName}（${material.fileSizeBytes} 字节）`).join("、")}。`,
          recommendation: "压缩或替换超限材料。",
          evidence: oversized.map(materialEvidence),
        }
      : {
          verdict: "passed",
          reason: `所有 ${materials.length} 份已上传材料均未超过 ${sizeMatch[1]} ${sizeMatch[2]}。`,
          recommendation: "",
          evidence,
        };
  }

  const countMatch = description.match(
    /(?:最多|至多|不超过)\s*(\d+)\s*(?:份|个|件|项)|(?:至少|不少于)\s*(\d+)\s*(?:份|个|件|项)|(?:恰好|正好)\s*(\d+)\s*(?:份|个|件|项)/,
  );
  if (countMatch) {
    const maximumCount = countMatch[1]
      ? Number(countMatch[1])
      : countMatch[3]
        ? Number(countMatch[3])
        : null;
    const minimumCount = countMatch[2]
      ? Number(countMatch[2])
      : countMatch[3]
        ? Number(countMatch[3])
        : null;
    const passed =
      (maximumCount === null || materials.length <= maximumCount) &&
      (minimumCount === null || materials.length >= minimumCount);
    return passed
      ? {
          verdict: "passed",
          reason: `当前有 ${materials.length} 份材料，符合数量要求。`,
          recommendation: "",
          evidence,
        }
      : {
          verdict: "failed",
          reason: `当前有 ${materials.length} 份材料；要求${maximumCount === minimumCount ? `恰好 ${maximumCount} 份` : `${minimumCount === null ? "" : `至少 ${minimumCount} 份`}${maximumCount === null ? "" : `，最多 ${maximumCount} 份`}`}。`,
          recommendation: "补充或移除材料，使数量符合要求。",
          evidence,
        };
  }

  if (/页/.test(description) && /PDF|总页数/i.test(description)) {
    if (/正文|摘要|指定范围/.test(description)) {
      return {
        verdict: "unable_to_check",
        reason: "要求限定的是正文或指定范围页数，当前解析器只读取 PDF 文件总页数。",
        recommendation: "明确页数统计范围后人工核验。",
        evidence,
      };
    }
    const pageLimit = description.match(/(?:不超过|至多|最多|≤|<=)\s*(\d+)\s*页/);
    if (!pageLimit)
      return {
        verdict: "needs_confirmation",
        reason: "识别到 PDF 页数要求，但没有可用的明确上限。",
        recommendation: "确认 PDF 页数边界。",
        evidence,
      };
    const pdfs = materials.filter((material) => material.extension === "pdf");
    if (!pdfs.length)
      return {
        verdict: materials.length ? "needs_confirmation" : "failed",
        reason: materials.length ? "尚无可确认的 PDF 材料。" : "尚未上传 PDF 材料。",
        recommendation: "上传 PDF 后检查总页数。",
        evidence: [],
      };
    if (pdfs.some((material) => material.pageCount === null)) {
      return {
        verdict: "unable_to_check",
        reason: "至少一份 PDF 未能可靠读取页数或解析不完整。",
        recommendation: "检查 PDF 文件是否有效，并人工确认页数。",
        evidence: pdfs.map(materialEvidence),
      };
    }
    const overLimit = pdfs.filter((material) => (material.pageCount ?? 0) > Number(pageLimit[1]));
    return overLimit.length
      ? {
          verdict: "failed",
          reason: `PDF 总页数超过 ${pageLimit[1]} 页：${overLimit.map((material) => `${material.originalFileName}（${material.pageCount} 页）`).join("、")}。`,
          recommendation: "删减 PDF 页面或重新整理材料。",
          evidence: overLimit.map(materialEvidence),
        }
      : {
          verdict: "passed",
          reason: `已读取 ${pdfs.length} 份 PDF 的总页数，均不超过 ${pageLimit[1]} 页。`,
          recommendation: "",
          evidence: pdfs.map(materialEvidence),
        };
  }

  if (/命名|文件名/.test(description)) {
    const fixedName =
      rule.parameters
        .find((parameter) => parameter.startsWith("filename_exact:"))
        ?.slice("filename_exact:".length) ??
      description.match(/(?:命名|文件名).{0,12}?[“"「『]([^”"」』]{1,180})[”"」』]/)?.[1] ??
      description.match(/按[“"「『]([^”"」』]{1,180})[”"」』].{0,8}命名/)?.[1];
    if (fixedName) {
      if (!materials.length) {
        return {
          verdict: "failed",
          reason: `尚未上传固定文件名为“${fixedName}”的材料。`,
          recommendation: `上传并确认文件名为“${fixedName}”的材料。`,
          evidence: [],
        };
      }
      if (materials.length !== 1) {
        return {
          verdict: "needs_confirmation",
          reason: `当前有 ${materials.length} 份材料，无法确认哪份材料适用固定文件名“${fixedName}”。`,
          recommendation: "人工指定需要核对名称的材料，或分开执行检查。",
          evidence,
        };
      }
      const material = materials[0];
      const passed = material?.originalFileName.normalize("NFC") === fixedName.normalize("NFC");
      return passed
        ? {
            verdict: "passed",
            reason: `文件名与通知中的固定名称“${fixedName}”一致。`,
            recommendation: "",
            evidence,
          }
        : {
            verdict: "failed",
            reason: `当前文件名为“${material?.originalFileName ?? "未知"}”，与要求的“${fixedName}”不一致。`,
            recommendation: `将文件准确命名为“${fixedName}”后重新上传。`,
            evidence,
          };
    }
    return {
      verdict: "unable_to_check",
      reason: "规则草稿没有提取出可执行的命名模式，无法可靠比较文件名。",
      recommendation: "人工确认通知中的命名格式。",
      evidence,
    };
  }

  if (/提交|提供|上传|材料|文件/.test(description) && rule.target !== "通知要求") {
    const target = rule.target.toLocaleLowerCase();
    const candidates = materials.filter((material) =>
      `${material.originalFileName} ${material.extractedText}`.toLocaleLowerCase().includes(target),
    );
    if (candidates.length === 1 && candidates[0]?.parseStatus === "text_extracted") {
      return {
        verdict: "needs_confirmation",
        reason: `找到可能对应“${target}”的材料，但当前没有内容审查能力，不能据文件存在判定材料完整。`,
        recommendation: "人工打开材料确认其内容与要求相符。",
        evidence: candidates.map(materialEvidence),
      };
    }
    if (!materials.length)
      return {
        verdict: "failed",
        reason: `尚未上传可能对应“${target}”的材料。`,
        recommendation: `上传并确认“${target}”材料。`,
        evidence: [],
      };
    return {
      verdict: "needs_confirmation",
      reason: "无法仅凭文件名可靠匹配该材料要求。",
      recommendation: "人工将上传文件与此要求对应。",
      evidence,
    };
  }

  return {
    verdict: "unable_to_check",
    reason: "当前没有与该规则对应的确定性检查工具。",
    recommendation: "人工复核此要求，勿将其视为通过。",
    evidence,
  };
}

export function executeReviewRule(
  rule: ReviewRule,
  materials: ReviewMaterialSummary[],
  background: ReviewTaskBackground,
): ReviewCheckResult {
  const applies = applicableRule(rule, background);
  const comparison =
    applies === false
      ? {
          verdict: "not_applicable" as const,
          reason: "该规则的个人/团队适用范围与任务背景不符。",
          recommendation: "",
          evidence: [],
        }
      : applies === undefined
        ? {
            verdict: "needs_confirmation" as const,
            reason: "规则包含条件，但当前项目背景不足以确认是否适用。",
            recommendation: "补充项目背景或人工确认适用条件。",
            evidence: [],
          }
        : rule.uncertainty || rule.strength === "unknown"
          ? {
              verdict: "needs_confirmation" as const,
              reason: rule.uncertainty || "规则强度尚未确认。",
              recommendation: "对照通知原文确认规则含义和强度。",
              evidence: [],
            }
          : rule.strength === "optional" && materials.length === 0
            ? {
                verdict: "not_applicable" as const,
                reason: "该项为可选材料，当前未提交，不构成缺失问题。",
                recommendation: "如需提交，可上传后检查其明确规格要求。",
                evidence: [],
              }
            : compareRule(rule, materials);
  return {
    ruleId: rule.id,
    ruleCode: rule.code,
    requirement: rule.description,
    strength: rule.strength,
    ...comparison,
    source: {
      sourceId: rule.source.sourceId,
      paragraphIndex: rule.source.paragraphIndex,
      quotedText: rule.source.quotedText,
    },
  };
}

export function executeDeterministicChecks(
  ruleSet: ReviewRuleSet,
  materials: ReviewMaterialSummary[],
  background: ReviewTaskBackground,
  createdAt: string,
  executionId: string,
): ReviewExecution {
  const results = ruleSet.rules.map((rule) => executeReviewRule(rule, materials, background));
  return {
    id: executionId,
    taskId: ruleSet.taskId,
    ruleSetId: ruleSet.id,
    sourceVersion: ruleSet.sourceVersion,
    status: "completed" as const,
    unexecutedCount: 0,
    materialSnapshot: materials.map(({ id, version }) => ({ materialId: id, version })),
    results,
    createdAt,
    completedAt: createdAt,
  };
}
