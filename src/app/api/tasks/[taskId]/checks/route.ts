import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import type { ReviewCheckResult, ReviewExecution } from "@/domain/review";
import { executeReviewRule } from "@/lib/review-checks";
import { getReviewStore } from "@/lib/server/review-store";

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
  const store = getReviewStore();
  if (!store.getTask(taskId))
    return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  return NextResponse.json(
    { executions: store.listReviewExecutions(taskId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }
  try {
    const store = getReviewStore();
    const task = store.getTask(taskId);
    if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
    const ruleSet = store
      .listRuleSets(taskId)
      .find((candidate) => candidate.sourceVersion === task.noticeSource.version);
    if (!ruleSet) {
      return NextResponse.json({ error: "请先根据当前通知生成规则草稿。" }, { status: 409 });
    }
    const createdAt = new Date().toISOString();
    const execution = {
      id: randomUUID(),
      taskId,
      ruleSetId: ruleSet.id,
      sourceVersion: ruleSet.sourceVersion,
      status: "running" as const,
      unexecutedCount: ruleSet.rules.length,
      materialSnapshot: task.materials.map(({ id, version }) => ({ materialId: id, version })),
      results: [] as ReviewExecution["results"],
      createdAt,
      completedAt: "",
    };
    store.saveReviewExecution(execution);
    const encoder = new TextEncoder();
    const streamState = { cancellationRequested: false };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const results: ReviewExecution["results"] = [];
        const send = (event: object): void => {
          if (!streamState.cancellationRequested)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        void (async () => {
          let executionStatus: "completed" | "cancelled" | "failed" = "completed";
          send({ type: "started", execution });
          for (const rule of ruleSet.rules) {
            if (streamState.cancellationRequested) {
              executionStatus = "cancelled";
              break;
            }
            let result: ReviewCheckResult;
            try {
              result = executeReviewRule(rule, task.materials, task.background);
            } catch {
              result = {
                ruleId: rule.id,
                ruleCode: rule.code,
                requirement: rule.description,
                strength: rule.strength,
                verdict: "unable_to_check",
                reason: "该项工具运行失败；其他独立检查继续执行。",
                recommendation: "人工复核，之后可重新运行检查。",
                source: {
                  sourceId: rule.source.sourceId,
                  paragraphIndex: rule.source.paragraphIndex,
                  quotedText: rule.source.quotedText,
                },
                evidence: [],
              };
            }
            store.appendReviewExecutionResult(execution.id, result);
            results.push(result);
            send({
              type: "result",
              result,
              completedCount: results.length,
              totalCount: ruleSet.rules.length,
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          if (streamState.cancellationRequested) executionStatus = "cancelled";
          const completedAt = new Date().toISOString();
          const unexecutedCount = ruleSet.rules.length - results.length;
          store.finishReviewExecution(execution.id, executionStatus, unexecutedCount, completedAt);
          const completedExecution = {
            ...execution,
            status: executionStatus,
            unexecutedCount,
            results,
            completedAt,
          };
          send({ type: "completed", execution: completedExecution });
          if (!streamState.cancellationRequested) controller.close();
        })().catch(() => {
          try {
            store.finishReviewExecution(
              execution.id,
              "failed",
              Math.max(0, ruleSet.rules.length - results.length),
              new Date().toISOString(),
            );
            send({ type: "error", message: "检查中断；已保存此前完成的结果。" });
            if (!streamState.cancellationRequested) controller.close();
          } catch {
            controller.error(new Error("Review execution stream failed"));
          }
        });
      },
      cancel() {
        streamState.cancellationRequested = true;
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return NextResponse.json({ error: "检查未能保存，请稍后重试。" }, { status: 500 });
  }
}
