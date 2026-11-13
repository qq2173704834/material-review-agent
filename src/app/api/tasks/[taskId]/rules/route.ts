import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { hasCurrentRuleSources, reviewRuleSchema, reviewRuleSetSchema } from "@/domain/review-rule";
import { extractMockRules } from "@/lib/rule-extractor";
import { findRuleConflicts } from "@/lib/rule-conflicts";
import { normalizeRules } from "@/lib/rule-normalization";
import { findMissingAttachmentWarnings } from "@/lib/attachment-dependencies";
import { getReviewStore } from "@/lib/server/review-store";
import { extractLiveRules } from "@/lib/server/live-rule-extractor";
import {
  getAiMode,
  getModelConfiguration,
  ModelServiceError,
  modelErrorResponse,
} from "@/lib/server/model-client";

import type { ReviewRuleSet } from "@/domain/review-rule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }

  try {
    if (!getReviewStore().getTask(taskId)) {
      return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
    }
    return NextResponse.json(
      { ruleSets: getReviewStore().listRuleSets(taskId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取当前任务的规则版本。" }, { status: 500 });
  }
}

const ruleGlobals = globalThis as typeof globalThis & { __preparingRuleTasks?: Set<string> };
const preparingRuleTasks = (ruleGlobals.__preparingRuleTasks ??= new Set<string>());

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }

  let acquired = false;
  try {
    const reviewStore = getReviewStore();
    const task = reviewStore.getTask(taskId);
    if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
    if (
      preparingRuleTasks.has(taskId) ||
      reviewStore.listReviewExecutions(taskId).some((item) => item.status === "running")
    )
      return NextResponse.json(
        { error: "该任务正在整理要求或执行检查，请等待结束，避免重复调用。" },
        { status: 409 },
      );
    if (new URL(request.url).searchParams.get("prepare") === "1") {
      const existing = reviewStore.listRuleSets(taskId);
      const current = existing.find(
        (item) =>
          item.sourceVersion === task.noticeSource.version &&
          hasCurrentRuleSources(item, [task.noticeSource, ...task.supplementalSources]),
      );
      if (current) return NextResponse.json({ ruleSet: current, reused: true });
      if (existing[0]?.rules.some((rule) => rule.generationMethod === "manual"))
        return NextResponse.json(
          {
            error:
              "来源已变化，旧审查要求包含人工调整。请先查看审查要求与新旧来源，再明确选择重新整理；系统不会自动覆盖人工修改。",
          },
          { status: 409 },
        );
    }
    preparingRuleTasks.add(taskId);
    acquired = true;
    const mode = new URL(request.url).searchParams.get("mode") === "mock" ? "mock" : getAiMode();
    const configuration = mode === "live" ? getModelConfiguration() : null;
    const sources = [task.noticeSource, ...task.supplementalSources];
    const sourceVersions = sources.map(({ id, version, displayName }) => ({
      sourceId: id,
      version,
      displayName,
    }));
    const extractedSources = sources.filter((source) => source.parseStatus === "text_extracted");
    if (!extractedSources.length)
      return NextResponse.json({ error: "当前来源没有可用于规则提取的正文。" }, { status: 422 });
    const extractedRules =
      mode === "live"
        ? await extractLiveRules(extractedSources, request.signal)
        : (() => {
            const sourceResults = extractedSources.map((source) =>
              extractMockRules({
                taskId,
                sourceId: source.id,
                sourceVersion: source.version,
                sourceDisplayName: source.displayName,
                noticeText: source.originalText,
              }),
            );
            const rules = sourceResults.flatMap((result) => result.rules);
            return {
              rules: rules.map((rule, index) => ({
                ...rule,
                code: `R-${String(index + 1).padStart(3, "0")}`,
              })),
              warnings: sourceResults.flatMap((result) => result.warnings),
              modelCalls: [],
            };
          })();
    extractedRules.rules = normalizeRules(extractedRules.rules);
    const createdAt = new Date().toISOString();
    const ruleSet = reviewRuleSetSchema.parse({
      id: randomUUID(),
      taskId,
      sourceId: task.noticeSource.id,
      sourceVersion: task.noticeSource.version,
      sourceVersions,
      mode,
      provider: configuration?.provider ?? "",
      model: configuration?.model ?? "",
      status: "completed",
      createdAt,
      ...extractedRules,
      warnings: [
        ...extractedRules.warnings,
        ...sources
          .filter((source) => source.parseStatus !== "text_extracted")
          .map((source) => ({
            code: "unsupported_input" as const,
            message: `来源“${source.displayName}”的解析状态为 ${source.parseStatus}，未参与规则提取。`,
          })),
        ...findRuleConflicts(extractedRules.rules),
        ...findMissingAttachmentWarnings(task.noticeSource, task.supplementalSources.length),
      ],
    }) satisfies ReviewRuleSet;

    for (const rule of ruleSet.rules) {
      const { startOffset, endOffset, quotedText } = rule.source;
      const source = sources.find((candidate) => candidate.id === rule.source.sourceId);
      const sourceSegment = source?.segments.find(
        (segment) => segment.paragraphIndex === rule.source.paragraphIndex,
      );
      if (
        !source ||
        source.version !== rule.source.sourceVersion ||
        !sourceSegment ||
        startOffset < sourceSegment.startOffset ||
        endOffset > sourceSegment.endOffset ||
        source.originalText.slice(startOffset, endOffset) !== quotedText
      ) {
        return NextResponse.json(
          { error: "生成结果包含无法定位到当前通知的原文引用，未保存规则。" },
          { status: 422 },
        );
      }
    }

    const latestTask = reviewStore.getTask(taskId);
    if (
      !latestTask ||
      latestTask.noticeSource.version !== task.noticeSource.version ||
      !hasCurrentRuleSources(ruleSet, [latestTask.noticeSource, ...latestTask.supplementalSources])
    )
      return NextResponse.json(
        { error: "整理期间来源发生变化，本次草稿未覆盖当前要求，请重新开始。" },
        { status: 409 },
      );
    reviewStore.saveRuleSet(ruleSet);
    return NextResponse.json(
      { ruleSet },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ModelServiceError) {
      const failure = modelErrorResponse(error);
      return NextResponse.json(
        { error: failure.error, code: failure.code, call: error.call },
        { status: failure.status },
      );
    }
    return NextResponse.json({ error: "审查要求未能保存，请稍后重试。" }, { status: 500 });
  } finally {
    if (acquired) preparingRuleTasks.delete(taskId);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("rules" in body)) {
    return NextResponse.json({ error: "规则修改内容无效。" }, { status: 400 });
  }
  const inputRules = body.rules;
  if (!Array.isArray(inputRules) || inputRules.length > 500) {
    return NextResponse.json({ error: "规则数量无效。" }, { status: 400 });
  }
  const parsedRules = inputRules.map((rule) => reviewRuleSchema.safeParse(rule));
  if (parsedRules.some((parsed) => !parsed.success)) {
    return NextResponse.json({ error: "至少一条规则字段不符合要求。" }, { status: 400 });
  }

  try {
    const store = getReviewStore();
    const task = store.getTask(taskId);
    if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
    if (store.listReviewExecutions(taskId).some((execution) => execution.status === "running")) {
      return NextResponse.json({ error: "任务正在检查中，暂时不能修改规则。" }, { status: 409 });
    }
    const currentRuleSet = store
      .listRuleSets(taskId)
      .find(
        (ruleSet) =>
          ruleSet.sourceVersion === task.noticeSource.version &&
          hasCurrentRuleSources(ruleSet, [task.noticeSource, ...task.supplementalSources]),
      );
    if (!currentRuleSet) {
      return NextResponse.json({ error: "请先为当前通知生成规则草稿。" }, { status: 409 });
    }
    const rules = parsedRules.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    const sources = [task.noticeSource, ...task.supplementalSources];
    const ruleIds = new Set<string>();
    for (const rule of rules) {
      if (
        (rule.additionalSources ?? []).some(
          (citation) =>
            !sources.some(
              (source) =>
                source.id === citation.sourceId &&
                source.version === citation.sourceVersion &&
                source.segments.some(
                  (segment) =>
                    segment.paragraphIndex === citation.paragraphIndex &&
                    citation.startOffset >= segment.startOffset &&
                    citation.endOffset <= segment.endOffset,
                ) &&
                source.originalText.slice(citation.startOffset, citation.endOffset) ===
                  citation.quotedText,
            ),
        )
      ) {
        return NextResponse.json(
          { error: "合并规则的补充引用必须来自本任务有效原文。" },
          { status: 422 },
        );
      }
      if (
        !sources.some(
          (source) =>
            source.id === rule.source.sourceId && source.version === rule.source.sourceVersion,
        ) ||
        ruleIds.has(rule.id) ||
        !sources.some((source) => {
          if (source.id !== rule.source.sourceId) return false;
          const segment = source.segments.find(
            (candidate) => candidate.paragraphIndex === rule.source.paragraphIndex,
          );
          return Boolean(
            segment &&
            rule.source.startOffset >= segment.startOffset &&
            rule.source.endOffset <= segment.endOffset &&
            source.originalText.slice(rule.source.startOffset, rule.source.endOffset) ===
              rule.source.quotedText,
          );
        })
      ) {
        return NextResponse.json(
          { error: "规则来源必须是当前任务来源中的有效原文位置。" },
          { status: 422 },
        );
      }
      if (
        rule.materialIds.some(
          (materialId) => !task.materials.some((material) => material.id === materialId),
        )
      ) {
        return NextResponse.json(
          { error: "规则只能指定当前任务中已存在的材料。" },
          { status: 422 },
        );
      }
      ruleIds.add(rule.id);
    }
    const editedRules = normalizeRules(
      rules.map((rule, index) => ({
        ...rule,
        id: randomUUID(),
        code: `R-${String(index + 1).padStart(3, "0")}`,
        generationMethod: "manual" as const,
      })),
    );
    const editedRuleSet = reviewRuleSetSchema.parse({
      ...currentRuleSet,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      rules: editedRules,
      warnings: [
        ...currentRuleSet.warnings.filter(
          (warning) =>
            warning.code !== "conflicting_constraints" ||
            (warning.message.startsWith("模型待核对关系候选") &&
              warning.relatedRuleIds?.every((id) => {
                const before = currentRuleSet.rules.find((rule) => rule.id === id),
                  after = editedRules.find((rule) => rule.id === id);
                return (
                  before &&
                  after &&
                  before.description === after.description &&
                  before.applicabilityCondition === after.applicabilityCondition &&
                  JSON.stringify(before.source) === JSON.stringify(after.source)
                );
              })),
        ),
        ...findRuleConflicts(editedRules),
      ],
    });
    store.saveRuleSet(editedRuleSet);
    return NextResponse.json({ ruleSet: editedRuleSet }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "规则修改未能保存，请稍后重试。" }, { status: 500 });
  }
}
