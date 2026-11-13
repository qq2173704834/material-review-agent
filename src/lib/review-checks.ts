import { hasComplexRelation } from "@/lib/conflict-scope";
import { compareAlignedFields } from "@/lib/field-alignment";
import type {
  ReviewCheckEvidence,
  ReviewCheckResult,
  ReviewExecution,
  ReviewMaterialSummary,
  ReviewTaskBackground,
} from "@/domain/review";
import type { ReviewRule, ReviewRuleSet } from "@/domain/review-rule";
import { findGregorianDates } from "@/lib/calendar-dates";
import { compareExtendedNumericRule } from "@/lib/numeric-review";
import { compareBudgetTotal, compareBudgetRatio } from "@/lib/budget-review";
import { compareTemplateRule, compareScopedCount } from "@/lib/structure-review";
import { compareRepositoryRule } from "@/lib/repository-review";
import { compareVideoRule } from "@/lib/video-review";

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

const CONSISTENCY_FIELDS = [
  "申请单位名称",
  "项目名称",
  "团队名称",
  "项目编号",
  "申报单位",
  "申请单位",
  "项目名",
  "负责人",
  "成员姓名",
  "团队成员",
  "指导老师",
  "联系电话",
  "电子邮箱",
] as const;

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

function dateRange(description: string): { minimum: number; maximum: number } | undefined {
  const dates = findGregorianDates(description);
  if (dates.length < 2) return undefined;
  for (let index = 0; index < dates.length - 1; index += 1) {
    const start = dates[index];
    const end = dates[index + 1];
    if (!start || !end) continue;
    const separator = description.slice(start.endIndex, end.startIndex);
    if (!/^[\s至到\-—~～]+$/u.test(separator) || start.timestamp > end.timestamp) continue;
    return { minimum: start.timestamp, maximum: end.timestamp };
  }
  return undefined;
}

function materialDateEvidence(
  material: ReviewMaterialSummary,
  matchedDateText: string,
): ReviewCheckEvidence {
  const segmentIndex = material.segments.findIndex((segment) =>
    segment.text.includes(matchedDateText),
  );
  const segment = material.segments[segmentIndex];
  return {
    materialId: material.id,
    materialVersion: material.version,
    quotedText: segment?.text ?? matchedDateText,
    region: segment?.region,
    location: segment?.location ?? "已提取全文",
    ...(segmentIndex >= 0 ? { segmentIndex } : {}),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldValues(material: ReviewMaterialSummary, field: string): string[] {
  const fieldPattern = new RegExp(
    `${escapeRegExp(field)}\\s*(?:[：:]|\\|)\\s*([^\\r\\n|,，;；。]+)`,
    "g",
  );
  const normalizedValues = new Set<string>();
  for (const match of material.extractedText.matchAll(fieldPattern)) {
    const value = match[1]
      ?.trim()
      .replace(/^[“”"'「『]|[“”"'」』]$/g, "")
      .trim();
    if (value) normalizedValues.add(value.normalize("NFC").replace(/\s+/gu, " "));
  }
  return [...normalizedValues];
}

function fieldEvidence(
  material: ReviewMaterialSummary,
  field: string,
  value: string,
): ReviewCheckEvidence {
  const fieldValuePattern = new RegExp(
    `${escapeRegExp(field)}\\s*(?:[：:]|\\|)\\s*${escapeRegExp(value)}`,
  );
  const segmentIndex = material.segments.findIndex((segment) =>
    fieldValuePattern.test(segment.text),
  );
  const segment = material.segments[segmentIndex];
  return {
    materialId: material.id,
    materialVersion: material.version,
    quotedText: segment?.text ?? `${field}：${value}`,
    region: segment?.region,
    location: segment?.location ?? "已提取全文",
    ...(segmentIndex >= 0 ? { segmentIndex } : {}),
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
  if (rule.applicabilityScope !== "unknown" && background.collaborationScope === "unknown")
    return undefined;
  if (rule.applicabilityCondition) {
    const answer = background.conditionAnswers?.find(
      (answer) => answer.condition === rule.applicabilityCondition,
    );
    if (answer) return answer.applies;
    if (
      /且|并且|同时|或者|\b(?:and|or)\b|除非|不属于|不适用于|非.*阶段/i.test(
        rule.applicabilityCondition,
      )
    )
      return undefined;
    const condition = rule.applicabilityCondition.replace(/\s/g, "").toLocaleLowerCase();
    if (/阶段|初赛|复赛|决赛|申报|结项/.test(condition)) {
      const stage = background.projectStage.replace(/\s/g, "").toLocaleLowerCase();
      if (!stage) return undefined;
      if (/(初赛|预赛)/.test(condition)) return /(初赛|预赛)/.test(stage);
      if (/(复赛|半决赛)/.test(condition)) return /(复赛|半决赛)/.test(stage);
      if (/决赛/.test(condition)) return /决赛/.test(stage);
      if (/申报/.test(condition)) return /申报/.test(stage);
      if (/结项/.test(condition)) return /结项/.test(stage);
      return undefined;
    }
    if (/类别|类型|领域/.test(condition)) {
      const projectType = background.projectType.replace(/\s/g, "").toLocaleLowerCase();
      if (!projectType) return undefined;
      const category = condition.match(
        /(?:适用于|针对|仅限|属于)([\p{L}\p{N}]{2,12})(?:项目|类别|类型|领域)?/u,
      )?.[1];
      return category ? projectType.includes(category) : undefined;
    }
    if (/如|若|如果|仅限|适用于|针对|当.*时/.test(condition)) return undefined;
  }
  if (rule.applicabilityScope !== "unknown" && background.collaborationScope !== "unknown")
    return true;
  if (rule.applicabilityCondition) return undefined;
  return true;
}

function compareRule(
  rule: ReviewRule,
  materials: ReviewMaterialSummary[],
  background: ReviewTaskBackground,
): Pick<ReviewCheckResult, "verdict" | "reason" | "recommendation" | "evidence"> {
  const description = rule.description;
  if (
    /姓名|申请人|负责人|证号|身份证|日期|金额|合计|预算/.test(description) &&
    materials.some((material) =>
      material.segments.some((segment) => segment.region?.status === "candidate"),
    )
  )
    return {
      verdict: "needs_confirmation",
      reason: "本条涉及图像关键字段，但仍有未核对区域；页面平均OCR分数不能代替关键字段与漏读核对。",
      recommendation: "先对照原图确认相关区域、阅读顺序与字段映射，再复检。",
      evidence: materials.flatMap((material) =>
        material.segments
          .filter((segment) => segment.region?.status === "candidate")
          .slice(0, 5)
          .map((segment) => ({
            materialId: material.id,
            materialVersion: material.version,
            segmentIndex: segment.segmentIndex,
            quotedText: segment.text,
            location: segment.location,
            region: segment.region,
          })),
      ),
    };
  if (hasComplexRelation(description) && !/二选一|至少一|任一/.test(description))
    return {
      verdict: "needs_confirmation",
      reason: "本条含例外、更正或替代关系；当前确定性工具不能将其当作无条件约束。",
      recommendation: "核对原文，在规则编辑中明确本次适用条件与实际约束；保留旧版本依据。",
      evidence: materials.map(materialEvidence),
    };
  const presencePattern = new RegExp(
    "^(?:必须|须|应|需|请)?(?:提交|提供|上传)(?:一份|1份)?\\s*" +
      escapeRegExp(rule.target) +
      "[。.!！]?$",
  );
  if (presencePattern.test(description.trim()) && rule.materialIds.length > 0) {
    return {
      verdict:
        materials.length && materials.every((material) => material.parseStatus !== "failed")
          ? "passed"
          : "needs_confirmation",
      reason: materials.length
        ? "已找到人工关联的目标材料；本项只检查提交存在性，内容和规格由独立规则核验。"
        : "人工关联材料不可用，需要重新确认匹配。",
      recommendation: materials.length ? "" : "重新选择对应材料。",
      evidence: materials.map(materialEvidence),
    };
  }
  if (
    /签章|印章|盖章|签名/.test(description) &&
    materials.some((material) => ["png", "jpg"].includes(material.extension))
  ) {
    const evidence = materials.flatMap((material) =>
      material.segments
        .filter(
          (segment) =>
            /图像辅助区域/.test(segment.location) || /签章|印章|盖章|签名/.test(segment.text),
        )
        .map((segment) => ({
          materialId: material.id,
          materialVersion: material.version,
          segmentIndex: segment.segmentIndex,
          location: segment.location,
          quotedText: segment.text,
        })),
    );
    return {
      verdict: "needs_confirmation",
      reason: evidence.length
        ? "已定位OCR或局部红色图形线索；需要人工打开图像核对签章。外观不证明真实性。"
        : "未定位可靠签章线索；不能据OCR或红色检测未命中断言没有签章。",
      recommendation: "人工检查签章、签字与授权依据；需要真实性核验时走官方核验渠道。",
      evidence,
    };
  }
  const repository = compareRepositoryRule(description, materials);
  if (repository) return repository;
  const ratio = compareBudgetRatio(description, materials);
  if (ratio) return ratio;
  const structure = compareTemplateRule(rule, materials) ?? compareScopedCount(rule, materials);
  if (structure) return structure;
  const video = compareVideoRule(description, materials);
  if (video) return video;
  if (/链接|网址|URL|站点/i.test(description) && /访问|打开|有效|可用/.test(description)) {
    const links = materials.filter((material) => material.parserName === "public-link");
    const evidence = links.map(materialEvidence);
    if (!links.length)
      return {
        verdict: "needs_confirmation",
        reason: "未关联带有访问记录的链接材料。",
        recommendation: "添加公开链接并读取访问状态。",
        evidence: [],
      };
    const records = links.map((material) => {
      try {
        return JSON.parse(material.segments[0]?.text ?? "") as {
          state?: string;
          fetchedAt?: string;
        };
      } catch {
        return {};
      }
    });
    if (records.some((record) => record.state === "not_found"))
      return {
        verdict: "failed",
        reason: "至少一个链接返回404或410，证据为保存时访问记录。",
        recommendation: "修正链接后重新添加并复检。",
        evidence,
      };
    if (records.every((record) => record.state === "accessible"))
      return {
        verdict: "passed",
        reason: "关联链接在记录时间均可公开访问；不代表其内容符合其他要求或未来持续可用。",
        recommendation: "",
        evidence,
      };
    return {
      verdict: "needs_confirmation",
      reason: "部分链接需要登录、返回其他HTTP错误或网络失败，不能据此断言失效。",
      recommendation: "核对权限或稍后重新读取。",
      evidence,
    };
  }
  const budget = compareBudgetTotal(description, materials);
  if (budget) return budget;
  const extendedNumeric = compareExtendedNumericRule(description, materials);
  if (extendedNumeric) return extendedNumeric;
  const evidence = materials.map(materialEvidence);
  const requiredDateRange = dateRange(description);
  if (requiredDateRange || /日期|有效期|期限/.test(description)) {
    if (!requiredDateRange)
      return {
        verdict: "unable_to_check",
        reason: "识别到日期要求，但当前无法将其解析为明确且有效的起止日期。",
        recommendation: "人工核对通知中的日期范围。",
        evidence,
      };
    if (!materials.length)
      return {
        verdict: "needs_confirmation",
        reason: "尚无材料可核对其日期。",
        recommendation: "上传日期信息完整且可提取的材料后重新检查。",
        evidence: [],
      };
    if (materials.some((material) => material.parseStatus !== "text_extracted"))
      return {
        verdict: "unable_to_check",
        reason: "至少一份材料未能完整提取文本，无法可靠核对材料日期。",
        recommendation: "替换为可完整解析的材料后重新检查。",
        evidence,
      };

    const datedMaterials = materials.map((material) => {
      const uniqueDates = new Map(
        findGregorianDates(material.extractedText).map((date) => [date.timestamp, date]),
      );
      return { material, dates: [...uniqueDates.values()] };
    });
    if (datedMaterials.some(({ dates }) => dates.length === 0))
      return {
        verdict: "unable_to_check",
        reason: "至少一份材料中没有识别到明确的公历日期。",
        recommendation: "人工确认材料日期后再判断是否符合范围。",
        evidence,
      };
    if (datedMaterials.some(({ dates }) => dates.length > 1))
      return {
        verdict: "needs_confirmation",
        reason: "材料中出现多个日期，当前无法判断哪一个是本项要求对应的日期。",
        recommendation: "人工指定需要核对的材料日期后重新检查。",
        evidence,
      };

    const outsideRange = datedMaterials.filter(({ dates }) => {
      const date = dates[0];
      return (
        !date ||
        date.timestamp < requiredDateRange.minimum ||
        date.timestamp > requiredDateRange.maximum
      );
    });
    const formatDate = (timestamp: number): string =>
      new Date(timestamp).toISOString().slice(0, 10);
    const rangeLabel = `${formatDate(requiredDateRange.minimum)} 至 ${formatDate(requiredDateRange.maximum)}`;
    return outsideRange.length
      ? {
          verdict: "failed",
          reason: `以下材料日期超出要求范围 ${rangeLabel}：${outsideRange
            .map(
              ({ material, dates }) =>
                `${material.originalFileName}（${dates[0]?.text ?? "日期未知"}）`,
            )
            .join("、")}。`,
          recommendation: "核对日期并替换为符合要求的材料。",
          evidence: outsideRange.flatMap(({ material, dates }) =>
            dates[0] ? [materialDateEvidence(material, dates[0].text)] : [],
          ),
        }
      : {
          verdict: "passed",
          reason: `所有 ${materials.length} 份材料的唯一可识别日期均在要求范围 ${rangeLabel} 内。`,
          recommendation: "",
          evidence: datedMaterials.flatMap(({ material, dates }) =>
            dates[0] ? [materialDateEvidence(material, dates[0].text)] : [],
          ),
        };
  }
  const consistencyField =
    description.match(/字段[“「"]([^”」"]{1,40})[”」"]/u)?.[1] ??
    CONSISTENCY_FIELDS.find((field) => description.includes(field));
  if (consistencyField && /一致|相同/.test(description)) {
    if (
      materials.some((material) =>
        material.segments.some(
          (segment) =>
            segment.region?.status === "candidate" && segment.text.includes(consistencyField),
        ),
      )
    )
      return {
        verdict: "needs_confirmation",
        reason: "待比较的图像字段所在区域尚未经人工核对，OCR平均分不能代替关键字段确认。",
        recommendation: "先核对区域文字与结构，再确认字段映射。",
        evidence,
      };
    const aligned = compareAlignedFields(
      consistencyField,
      materials,
      background.fieldMappings ?? [],
    );
    if (aligned) return aligned;
    if (materials.length < 2)
      return {
        verdict: "needs_confirmation",
        reason: `至少需要两份材料才能比较“${consistencyField}”。`,
        recommendation: "补充相关材料后重新检查。",
        evidence,
      };
    if (materials.some((material) => material.parseStatus !== "text_extracted"))
      return {
        verdict: "unable_to_check",
        reason: "至少一份材料未能完整提取文本，无法可靠比较字段一致性。",
        recommendation: "替换为可完整解析的材料后重新检查。",
        evidence,
      };

    const materialFields = materials.map((material) => ({
      material,
      values: fieldValues(material, consistencyField),
    }));
    if (materialFields.some(({ values }) => values.length === 0))
      return {
        verdict: "needs_confirmation",
        reason: `至少一份材料没有明确的“${consistencyField}”字段，无法完成跨材料比较。`,
        recommendation: "人工确认字段位置或补充相关材料。",
        evidence,
      };
    if (materialFields.some(({ values }) => values.length > 1))
      return {
        verdict: "needs_confirmation",
        reason: `至少一份材料中“${consistencyField}”出现多个不同值。`,
        recommendation: "人工确认每份材料中本次审查适用的字段值。",
        evidence,
      };

    const distinctValues = new Set(materialFields.map(({ values }) => values[0]));
    const fieldEvidenceList = materialFields.flatMap(({ material, values }) => {
      const value = values[0];
      return value ? [fieldEvidence(material, consistencyField, value)] : [];
    });
    if (distinctValues.size > 1)
      return {
        verdict: "failed",
        reason: `材料中的“${consistencyField}”不一致：${materialFields
          .map(({ material, values }) => `${material.originalFileName}（${values[0] ?? "未知"}）`)
          .join("、")}。`,
        recommendation: "核实并统一各份材料中的字段值。",
        evidence: fieldEvidenceList,
      };
    return {
      verdict: "passed",
      reason: `${materials.length} 份材料中的“${consistencyField}”一致。`,
      recommendation: "",
      evidence: fieldEvidenceList,
    };
  }
  const characterLimit = description.match(
    /(?:不超过|至多|最多|≤|<=)\s*(\d+)\s*(?:个)?(?:汉字|字|字符)|(?:不少于|至少|≥|>=)\s*(\d+)\s*(?:个)?(?:汉字|字|字符)/,
  );
  if (characterLimit) {
    if (/正文|摘要|指定章节|指定范围/.test(description))
      return {
        verdict: "unable_to_check",
        reason: "要求限定的是正文、摘要或指定范围字数，当前只能统计已解析全文字符数。",
        recommendation: "明确统计范围后人工核验。",
        evidence,
      };
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
    const pageLimit = description.match(
      /(?:不得超过|不超过|不大于|至多|最多|最大|≤|<=)\s*(\d+)\s*页/,
    );
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
      if (/[{｛]/.test(fixedName)) {
        const placeholders = [...fixedName.matchAll(/[{｛]([^}｝]+)[}｝]/g)].map(
          (match) => match[1]!,
        );
        const supported = [...CONSISTENCY_FIELDS, "姓名", "编号"];
        if (!placeholders.length || placeholders.some((field) => !supported.includes(field)))
          return {
            verdict: "needs_confirmation",
            reason: "命名模板包含无法确定取值的字段。",
            recommendation: "使用明确的项目名称、负责人、项目编号或姓名字段，并在材料中填写其值。",
            evidence,
          };
        if (!materials.length)
          return {
            verdict: "failed",
            reason: "尚未上传适用命名模板的材料。",
            recommendation: "上传对应材料后核验命名。",
            evidence,
          };
        const expectedNames: Array<{ material: ReviewMaterialSummary; expected: string }> = [];
        for (const material of materials) {
          let expected = fixedName;
          for (const field of placeholders) {
            const values = fieldValues(material, field);
            if (values.length !== 1 || material.parseStatus !== "text_extracted")
              return {
                verdict: "needs_confirmation",
                reason: `${material.originalFileName} 的“${field}”缺失、多值或解析不完整，无法可靠生成应有文件名。`,
                recommendation: "核对字段和材料匹配后复检。",
                evidence,
              };
            expected = expected
              .replaceAll(`{${field}}`, values[0]!)
              .replaceAll(`｛${field}｝`, values[0]!);
          }
          expectedNames.push({ material, expected });
        }
        const failures = expectedNames.filter(
          ({ material, expected }) =>
            material.originalFileName.normalize("NFC") !== expected.normalize("NFC"),
        );
        return {
          verdict: failures.length ? "failed" : "passed",
          reason: expectedNames
            .map(({ material, expected }) => `${material.originalFileName} → 应为 ${expected}`)
            .join("；"),
          recommendation: failures.length ? "按材料中核对过的真实字段重命名并重新上传。" : "",
          evidence: expectedNames.flatMap(({ material }) =>
            placeholders.flatMap((field) =>
              fieldValues(material, field).map((value) => fieldEvidence(material, field, value)),
            ),
          ),
        };
      }
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
          reason: "该规则的适用条件或个人/团队范围与已确认背景不符。",
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
            : compareRule(rule, materials, background);
  return {
    ruleId: rule.id,
    ruleCode: rule.code,
    comparisonKey: JSON.stringify([
      rule.description,
      rule.target,
      rule.strength,
      rule.applicabilityScope,
      rule.applicabilityCondition,
      rule.parameters,
      [...rule.materialIds].sort(),
      rule.checkability,
      rule.source.sourceId,
      rule.source.quotedText,
    ]),
    requirement: rule.description,
    strength: rule.strength,
    ...comparison,
    evidence: comparison.evidence.map((citation) => ({
      ...citation,
      region:
        citation.region ??
        materials
          .find(
            (material) =>
              material.id === citation.materialId && material.version === citation.materialVersion,
          )
          ?.segments.find((segment) => segment.segmentIndex === citation.segmentIndex)?.region,
    })),
    source: {
      sourceId: rule.source.sourceId,
      sourceVersion: rule.source.sourceVersion,
      displayName: rule.source.displayName,
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
