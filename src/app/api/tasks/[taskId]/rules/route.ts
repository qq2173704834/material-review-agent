import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { reviewRuleSchema, reviewRuleSetSchema } from "@/domain/review-rule";
import { extractMockRules } from "@/lib/rule-extractor";
import { findRuleConflicts } from "@/lib/rule-conflicts";
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

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }

  try {
    const reviewStore = getReviewStore();
    const task = reviewStore.getTask(taskId);
    if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });

    const mode = getAiMode();
    const configuration = mode === "live" ? getModelConfiguration() : null;
    const extractedRules =
      mode === "live"
        ? await extractLiveRules(task.noticeSource, request.signal)
        : extractMockRules({
            taskId,
            sourceId: task.noticeSource.id,
            sourceVersion: task.noticeSource.version,
            noticeText: task.noticeSource.originalText,
          });
    const createdAt = new Date().toISOString();
    const ruleSet = reviewRuleSetSchema.parse({
      id: randomUUID(),
      taskId,
      sourceId: task.noticeSource.id,
      sourceVersion: task.noticeSource.version,
      mode,
      provider: configuration?.provider ?? "",
      model: configuration?.model ?? "",
      status: "completed",
      createdAt,
      ...extractedRules,
      warnings: [...extractedRules.warnings, ...findRuleConflicts(extractedRules.rules)],
    }) satisfies ReviewRuleSet;

    for (const rule of ruleSet.rules) {
      const { startOffset, endOffset, quotedText } = rule.source;
      const sourceSegment = task.noticeSource.segments.find(
        (segment) => segment.paragraphIndex === rule.source.paragraphIndex,
      );
      if (
        !sourceSegment ||
        startOffset < sourceSegment.startOffset ||
        endOffset > sourceSegment.endOffset ||
        task.noticeSource.originalText.slice(startOffset, endOffset) !== quotedText
      ) {
        return NextResponse.json(
          { error: "生成结果包含无法定位到当前通知的原文引用，未保存规则。" },
          { status: 422 },
        );
      }
    }

    reviewStore.saveRuleSet(ruleSet);
    return NextResponse.json(
      { ruleSet },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ModelServiceError) {
      const failure = modelErrorResponse(error);
      return NextResponse.json(
        { error: failure.error, code: failure.code },
        { status: failure.status },
      );
    }
    return NextResponse.json({ error: "规则草稿未能保存，请稍后重试。" }, { status: 500 });
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
      .find((ruleSet) => ruleSet.sourceVersion === task.noticeSource.version);
    if (!currentRuleSet) {
      return NextResponse.json({ error: "请先为当前通知生成规则草稿。" }, { status: 409 });
    }
    const rules = parsedRules.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    const ruleIds = new Set<string>();
    for (const rule of rules) {
      if (
        rule.source.sourceId !== task.noticeSource.id ||
        rule.source.sourceVersion !== task.noticeSource.version ||
        ruleIds.has(rule.id) ||
        task.noticeSource.originalText.slice(rule.source.startOffset, rule.source.endOffset) !==
          rule.source.quotedText
      ) {
        return NextResponse.json(
          { error: "规则来源必须是当前通知中的有效原文位置。" },
          { status: 422 },
        );
      }
      ruleIds.add(rule.id);
    }
    const editedRuleSet = reviewRuleSetSchema.parse({
      ...currentRuleSet,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      rules: rules.map((rule, index) => ({
        ...rule,
        id: randomUUID(),
        code: `R-${String(index + 1).padStart(3, "0")}`,
        generationMethod: "manual" as const,
      })),
    });
    store.saveRuleSet(editedRuleSet);
    return NextResponse.json({ ruleSet: editedRuleSet }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "规则修改未能保存，请稍后重试。" }, { status: 500 });
  }
}
