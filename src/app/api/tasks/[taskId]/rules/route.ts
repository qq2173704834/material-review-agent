import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { reviewRuleSetSchema } from "@/domain/review-rule";
import { extractMockRules } from "@/lib/rule-extractor";
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
