import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { qualityCases } from "../tests/fixtures/quality-cases.mjs";

const baseUrl = process.env.REVIEW_EVALUATION_URL || "http://127.0.0.1:3120";
const url = new URL(baseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Evaluation must use a local isolated service");
const outputDirectory = resolve(".local-data/quality-results");
await mkdir(outputDirectory, { recursive: true });
const hash = createHash("sha256");
async function hashDirectory(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await hashDirectory(path);
    else hash.update(path.slice(process.cwd().length)).update(await readFile(path));
  }
}
await hashDirectory(resolve("src"));
const startedAt = new Date().toISOString();
const run = {
  version: 1,
  startedAt,
  sourceDigest: hash.digest("hex"),
  labelOrigin: "工程合成参考标注（非独立人工金标准）",
  sampleCount: 20,
  expectedRuleCount: 60,
  results: [],
  metrics: {},
};
async function json(path, options) {
  const response = await fetch(baseUrl + path, {
    ...options,
    signal: AbortSignal.timeout(600_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(payload.error ?? `HTTP ${response.status}`), {
      call: payload.call,
    });
  return payload;
}
for (const sample of qualityCases) {
  const start = Date.now();
  let taskId;
  try {
    const { task } = await json("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: sample.id + " " + sample.domain,
        description: "隔离数据目录的合成评估任务",
        noticeText: sample.notice,
      }),
    });
    taskId = task.id;
    for (const file of sample.files) {
      const form = new FormData();
      form.append("files", new Blob([file.text]), file.name);
      await json(`/api/tasks/${taskId}/materials`, { method: "POST", body: form });
    }
    const { ruleSet } = await json(`/api/tasks/${taskId}/rules`, { method: "POST" });
    const executionResponse = await fetch(baseUrl + `/api/tasks/${taskId}/checks?full=1`, {
      method: "POST",
      signal: AbortSignal.timeout(600_000),
    });
    await executionResponse.text();
    if (!executionResponse.ok) throw new Error(`Review HTTP ${executionResponse.status}`);
    const { executions } = await json(`/api/tasks/${taskId}/checks`);
    const execution = executions[0];
    const details = (await json(`/api/tasks/${taskId}`)).task;
    const labels = sample.labels.map((label) => {
      const rules = ruleSet.rules.filter((rule) =>
        new RegExp(label.descriptionPattern).test(rule.description),
      );
      const results = execution.results.filter((result) =>
        rules.some((rule) => rule.id === result.ruleId),
      );
      return {
        ...label,
        matchedRules: rules.length,
        actual: results.map((result) => result.verdict),
        passed: rules.length === 1 && results.length === 1 && results[0].verdict === label.expected,
      };
    });
    const evidence = execution.results
      .flatMap((result) => result.evidence)
      .filter((item) => item.segmentIndex !== undefined);
    const validEvidence = evidence.filter((item) =>
      details.materials.some(
        (material) =>
          material.id === item.materialId &&
          material.version === item.materialVersion &&
          material.segments.some(
            (segment) =>
              segment.segmentIndex === item.segmentIndex &&
              segment.location === item.location &&
              segment.text.includes(item.quotedText),
          ),
      ),
    );
    run.results.push({
      id: sample.id,
      partition: sample.partition,
      domain: sample.domain,
      taskId,
      elapsedMs: Date.now() - start,
      mode: ruleSet.mode,
      provider: ruleSet.provider,
      model: ruleSet.model,
      labels,
      extractedRuleCount: ruleSet.rules.length,
      evidenceCount: evidence.length,
      validEvidenceCount: validEvidence.length,
      ruleSet,
      execution,
    });
    console.log(
      `${sample.id}: ${labels.filter((label) => label.passed).length}/3 assertions; ${Date.now() - start}ms`,
    );
  } catch (error) {
    run.results.push({
      id: sample.id,
      taskId,
      error: error instanceof Error ? error.message : "Evaluation failed",
      call: error.call,
      elapsedMs: Date.now() - start,
    });
    console.log(`${sample.id}: failed; see saved evaluation result`);
  }
  await writeFile(resolve(outputDirectory, "latest.json"), JSON.stringify(run, null, 2));
}
const successful = run.results.filter((item) => item.labels);
const labels = successful.flatMap((item) => item.labels);
const expectedFailures = labels.filter((label) => label.expected === "failed");
const expectedPasses = labels.filter((label) => label.expected === "passed");
const calls = [
  ...successful.flatMap((item) => [
    ...item.ruleSet.modelCalls,
    ...(item.execution.metadata?.modelCalls ?? []),
  ]),
  ...run.results.filter((item) => item.call).map((item) => item.call),
];
run.metrics = {
  completedTasks: successful.length,
  totalTasks: qualityCases.length,
  exactVerdicts: labels.filter((label) => label.passed).length,
  expectedVerdicts: 60,
  matchedReferenceRules: labels.filter((label) => label.matchedRules > 0).length,
  expectedReferenceRules: 60,
  extractedRules: successful.reduce((sum, item) => sum + item.extractedRuleCount, 0),
  detectedProblems: expectedFailures.filter((label) => label.actual.includes("failed")).length,
  referenceProblems: expectedFailures.length,
  falseAlarms: expectedPasses.filter((label) => label.actual.includes("failed")).length,
  referencePasses: expectedPasses.length,
  evidenceCorrect: successful.reduce((sum, item) => sum + item.validEvidenceCount, 0),
  evidenceTotal: successful.reduce((sum, item) => sum + item.evidenceCount, 0),
  uncertainResults: successful
    .flatMap((item) => item.execution.results)
    .filter((item) => ["needs_confirmation", "unable_to_check"].includes(item.verdict)).length,
  elapsedMs: Date.now() - Date.parse(startedAt),
  modelCalls: calls.length,
  inputTokens: calls.every((call) => call.inputTokens !== null)
    ? calls.reduce((sum, call) => sum + call.inputTokens, 0)
    : null,
  outputTokens: calls.every((call) => call.outputTokens !== null)
    ? calls.reduce((sum, call) => sum + call.outputTokens, 0)
    : null,
  cost: "未配置有版本的价格来源，不估算费用；实际额度以服务商控制台为准",
};
run.completedAt = new Date().toISOString();
await writeFile(resolve(outputDirectory, "latest.json"), JSON.stringify(run, null, 2));
console.log(JSON.stringify(run.metrics));
