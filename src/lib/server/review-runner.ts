import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { reviewTaskIdSchema } from "@/domain/review-task";
import { hasCurrentRuleSources } from "@/domain/review-rule";
import type { ReviewCheckResult, ReviewExecution } from "@/domain/review";
import { executeReviewRule } from "@/lib/review-checks";
import { getReviewStore } from "@/lib/server/review-store";
import { annotateLinkedExecutions as annotateExecutions } from "@/lib/server/exam-execution-validity";
import {
  getAiMode,
  getModelConfiguration,
  ModelServiceError,
  modelErrorResponse,
} from "@/lib/server/model-client";
import { reviewLiveRule } from "@/lib/server/semantic-review";
import { createRecheckPlan } from "@/lib/server/recheck-plan";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

const reviewGlobals = globalThis as typeof globalThis & { __activeReviewTasks?: Set<string> };
const activeReviewTasks = (reviewGlobals.__activeReviewTasks ??= new Set<string>());

export async function reviewChecksState(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }
  const store = getReviewStore();
  const task = store.getTask(taskId);
  if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
  const ruleSets = store.listRuleSets(taskId);
  const executions = store.listReviewExecutions(taskId);
  const rules = ruleSets.find((item) =>
    hasCurrentRuleSources(item, [task.noticeSource, ...task.supplementalSources]),
  );
  let plan: ReturnType<typeof createRecheckPlan> = [];
  try {
    if (rules)
      plan = createRecheckPlan(
        task,
        rules,
        executions[0],
        false,
        new URL(request.url).searchParams.get("mode") === "mock" ? "mock" : undefined,
      );
  } catch {
    /* Configuration errors are surfaced when starting a check. */
  }
  return NextResponse.json(
    {
      plan: plan.map(({ ruleId, ruleCode, action, reason }) => ({
        ruleId,
        ruleCode,
        action,
        reason,
      })),
      executions: annotateExecutions(
        task,
        store.listRuleSets(taskId),
        store.listReviewExecutions(taskId),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function runReviewChecks(request: Request, context: RouteContext): Promise<Response> {
  const { taskId } = await context.params;
  if (!reviewTaskIdSchema.safeParse(taskId).success) {
    return NextResponse.json({ error: "任务编号无效。" }, { status: 400 });
  }
  let acquired = false;
  try {
    const store = getReviewStore();
    const task = store.getTask(taskId);
    if (!task) return NextResponse.json({ error: "没有找到该任务。" }, { status: 404 });
    const ruleSet = store
      .listRuleSets(taskId)
      .find(
        (candidate) =>
          candidate.sourceVersion === task.noticeSource.version &&
          hasCurrentRuleSources(candidate, [task.noticeSource, ...task.supplementalSources]),
      );
    if (!ruleSet) {
      return NextResponse.json(
        { error: "来源已变化，请先根据当前全部要求来源重新生成规则草稿。" },
        { status: 409 },
      );
    }
    if (activeReviewTasks.has(taskId))
      return NextResponse.json({ error: "该任务正在检查，请等待结束或先取消。" }, { status: 409 });
    const mode = new URL(request.url).searchParams.get("mode") === "mock" ? "mock" : getAiMode();
    const configuration = mode === "live" ? getModelConfiguration() : null;
    const plan = createRecheckPlan(
      task,
      ruleSet,
      store.listReviewExecutions(taskId)[0],
      new URL(request.url).searchParams.get("full") === "1",
      mode,
    );
    activeReviewTasks.add(taskId);
    acquired = true;
    const createdAt = new Date().toISOString();
    const metadata: NonNullable<ReviewExecution["metadata"]> = {
      mode,
      provider: configuration?.provider ?? "",
      model: configuration?.model ?? "",
      modelCalls: [],
      backgroundSnapshot: task.background,
      limitations:
        mode === "mock"
          ? ["规则与语义流程处于模拟模式，未调用真实模型；确定性工具读取实际文件属性。"]
          : [
              "语义检查每项最多纳入 24,000 字符、60 个片段；覆盖不足时保留待确认。",
              `本轮最多 ${configuration?.maxCallsPerReview} 个模型步骤，每步最多一次自动重试；执行总时限 180 秒。`,
            ],
    };
    const execution: ReviewExecution = {
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
      metadata,
    };
    store.saveReviewExecution(execution);
    const encoder = new TextEncoder();
    const streamState = { cancellationRequested: false };
    const cancellation = new AbortController();
    const onAbort = (): void => {
      streamState.cancellationRequested = true;
      cancellation.abort();
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    const executionTimeout = AbortSignal.timeout(180000);
    const signal = AbortSignal.any([cancellation.signal, executionTimeout]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const results: ReviewExecution["results"] = [];
        const send = (event: object): void => {
          if (!streamState.cancellationRequested) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {
              onAbort();
            }
          }
        };
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10000);
        void (async () => {
          let executionStatus: "completed" | "cancelled" | "failed" = "completed";
          send({ type: "started", execution });
          for (const rule of ruleSet.rules) {
            if (signal.aborted) {
              executionStatus = streamState.cancellationRequested ? "cancelled" : "failed";
              break;
            }
            send({
              type: "checking",
              ruleCode: rule.code,
              completedCount: results.length,
              totalCount: ruleSet.rules.length,
            });
            let result: ReviewCheckResult;
            const planned = plan.find((item) => item.ruleId === rule.id)!;
            const ruleMaterials = rule.materialIds.length
              ? task.materials.filter((material) => rule.materialIds.includes(material.id))
              : task.materials;
            const unresolvedConflict = ruleSet.warnings.find(
              (warning) =>
                warning.code === "conflicting_constraints" &&
                warning.relatedRuleIds?.includes(rule.id),
            );
            try {
              if (planned.reusableResult) {
                result = planned.reusableResult;
              } else if (unresolvedConflict) {
                result = {
                  ruleId: rule.id,
                  ruleCode: rule.code,
                  requirement: rule.description,
                  strength: rule.strength,
                  verdict: "needs_confirmation",
                  reason: unresolvedConflict.message,
                  recommendation: "在规则草稿中指定采用依据，或先保持待确认。",
                  source: {
                    sourceId: rule.source.sourceId,
                    sourceVersion: rule.source.sourceVersion,
                    displayName: rule.source.displayName,
                    paragraphIndex: rule.source.paragraphIndex,
                    quotedText: rule.source.quotedText,
                  },
                  evidence: [],
                };
              } else if (mode === "live") {
                const reviewed = await reviewLiveRule({
                  rule,
                  materials: ruleMaterials,
                  background: task.background,
                  signal,
                  canCallModel:
                    metadata.modelCalls.length < (configuration?.maxCallsPerReview ?? 0),
                });
                result = reviewed.result;
                if (reviewed.call) metadata.modelCalls.push(reviewed.call);
              } else
                result = {
                  ...executeReviewRule(rule, ruleMaterials, task.background),
                  method: "deterministic",
                };
            } catch (error) {
              if (error instanceof ModelServiceError && error.call)
                metadata.modelCalls.push({
                  ...error.call,
                  status: "failed",
                  errorCode: error.code,
                });
              if (signal.aborted) {
                executionStatus = streamState.cancellationRequested ? "cancelled" : "failed";
                break;
              }
              result = {
                ruleId: rule.id,
                ruleCode: rule.code,
                requirement: rule.description,
                strength: rule.strength,
                verdict: "unable_to_check",
                reason:
                  error instanceof ModelServiceError
                    ? error.message
                    : "该项工具运行失败；其他独立检查继续执行。",
                recommendation: "人工复核，之后可重新运行检查。",
                source: {
                  sourceId: rule.source.sourceId,
                  sourceVersion: rule.source.sourceVersion,
                  displayName: rule.source.displayName,
                  paragraphIndex: rule.source.paragraphIndex,
                  quotedText: rule.source.quotedText,
                },
                evidence: [],
                method: "unavailable",
              };
            }
            result = {
              ...result,
              dependencyKey: planned.dependencyKey,
              checkedAt: result.checkedAt ?? new Date().toISOString(),
            };
            store.appendReviewExecutionResult(execution.id, result, metadata);
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
          if (executionTimeout.aborted && !streamState.cancellationRequested) {
            executionStatus = "failed";
            metadata.limitations.push("执行达到 180 秒总时限，剩余规则未执行。");
          }
          const completedAt = new Date().toISOString();
          const unexecutedCount = ruleSet.rules.length - results.length;
          store.finishReviewExecution(
            execution.id,
            executionStatus,
            unexecutedCount,
            completedAt,
            metadata,
          );
          const completedExecution = {
            ...execution,
            status: executionStatus,
            unexecutedCount,
            results,
            completedAt,
          };
          const latestTask = store.getTask(taskId);
          const finalExecution = latestTask
            ? annotateExecutions(latestTask, store.listRuleSets(taskId), [completedExecution])[0]
            : completedExecution;
          send({ type: "completed", execution: finalExecution });
          if (!streamState.cancellationRequested) controller.close();
        })()
          .catch(() => {
            try {
              store.finishReviewExecution(
                execution.id,
                streamState.cancellationRequested ? "cancelled" : "failed",
                Math.max(0, ruleSet.rules.length - results.length),
                new Date().toISOString(),
                metadata,
              );
              send({ type: "error", message: "检查中断；已保存此前完成的结果。" });
              if (!streamState.cancellationRequested) controller.close();
            } catch {
              controller.error(new Error("Review execution stream failed"));
            }
          })
          .finally(() => {
            clearInterval(heartbeat);
            request.signal.removeEventListener("abort", onAbort);
            activeReviewTasks.delete(taskId);
          });
      },
      cancel() {
        onAbort();
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
  } catch (error) {
    if (acquired) activeReviewTasks.delete(taskId);
    if (error instanceof ModelServiceError) {
      const failure = modelErrorResponse(error);
      return NextResponse.json(
        { error: failure.error, code: failure.code },
        { status: failure.status },
      );
    }
    return NextResponse.json({ error: "检查未能保存，请稍后重试。" }, { status: 500 });
  }
}
