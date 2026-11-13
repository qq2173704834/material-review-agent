import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url),
  origin = "http://127.0.0.1:3120",
  records = [];
async function json(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(origin + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const isStream = r.headers.get("content-type")?.includes("text/event-stream");
  const payload = isStream ? await r.text() : await r.json();
  if (!r.ok) throw new Error(r.status + " " + payload.error);
  return payload;
}
const taskIds = [];
try {
  const { task } = await json("/api/tasks", {
    name: "真实仓库资料验收",
    noticeText: "仓库必须提供README与依赖清单。",
  });
  taskIds.push(task.id);
  const imported = await json(`/api/tasks/${task.id}/links`, {
    name: "公开Express仓库",
    url: "https://github.com/expressjs/express",
    repository: true,
  });
  assert.equal(imported.state, "accessible");
  assert.ok(
    imported.material.segments.some((segment) => /仓库文件 .* · blob /.test(segment.location)),
    JSON.stringify(imported.material.segments.map((segment) => segment.location)),
  );
  const { ruleSet } = await json(`/api/tasks/${task.id}/rules`, {});
  const rule = {
    ...ruleSet.rules[0],
    description: task.noticeSource.originalText,
    target: "全部材料",
    uncertainty: "",
    applicabilityCondition: "",
    applicabilityScope: "unknown",
    checkability: "deterministic",
    strength: "required",
    materialIds: [imported.material.id],
    source: {
      ...ruleSet.rules[0].source,
      quotedText: task.noticeSource.originalText,
      startOffset: 0,
      endOffset: task.noticeSource.originalText.length,
    },
  };
  await json(`/api/tasks/${task.id}/rules`, { rules: [rule] }, "PATCH");
  await json(`/api/tasks/${task.id}/checks`, {});
  const execution = (await json(`/api/tasks/${task.id}/checks`)).executions[0];
  assert.equal(execution.results[0].verdict, "passed");
  assert.ok(execution.results[0].evidence.every((e) => e.location.includes("blob")));
  const answer = await json(`/api/tasks/${task.id}/questions`, {
    executionId: execution.id,
    ruleId: execution.results[0].ruleId,
    question: "这项通过能证明仓库代码可以运行吗？请解释核验范围。",
  });
  assert.equal(answer.mode, "live");
  assert.ok(answer.answer.length > 20);
  records.push({
    case: "仓库真实文件与结果追问",
    status: "passed",
    model: execution.metadata?.model,
    locations: execution.results[0].evidence.map((e) => e.location),
    questionModelCall: answer.call,
    ruleCalls: ruleSet.modelCalls,
  });
  const { task: videoTask } = await json("/api/tasks", {
    name: "视频内容实际辅助验收",
    noticeText: "项目视频必须展示预算总额12000并列出Capture和Analyze两个操作步骤。",
  });
  taskIds.push(videoTask.id);
  const directory = resolve("work", "live-video");
  await mkdir(directory, { recursive: true });
  const canvas = createCanvas(1280, 720),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "black";
  ctx.font = "54px Arial";
  ctx.fillText("PROJECT VIDEO DEMONSTRATION", 60, 110);
  ctx.fillText("Budget total: 12000", 60, 250);
  ctx.fillText("Step 1: Capture sensor data", 60, 390);
  ctx.fillText("Step 2: Analyze energy usage", 60, 510);
  await writeFile(resolve(directory, "frame.png"), canvas.toBuffer("image/png"));
  execFileSync(
    require.resolve("@ffmpeg-installer/win32-x64/ffmpeg.exe"),
    [
      "-nostdin",
      "-v",
      "error",
      "-loop",
      "1",
      "-i",
      resolve(directory, "frame.png"),
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      resolve(directory, "demo.mp4"),
    ],
    { windowsHide: true, timeout: 20000 },
  );
  const form = new FormData();
  form.set(
    "files",
    new Blob([await readFile(resolve(directory, "demo.mp4"))], { type: "video/mp4" }),
    "项目视频.mp4",
  );
  const upload = await fetch(origin + `/api/tasks/${videoTask.id}/materials`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  assert.equal(upload.status, 201);
  const saved = (await json(`/api/tasks/${videoTask.id}`)).task;
  assert.ok(saved.materials[0].extractedText.includes("12000"));
  const { ruleSet: videoRules } = await json(`/api/tasks/${videoTask.id}/rules`, {});
  await json(`/api/tasks/${videoTask.id}/checks`, {});
  const videoExecution = (await json(`/api/tasks/${videoTask.id}/checks`)).executions[0];
  assert.equal(videoExecution.status, "completed");
  assert.ok(
    videoExecution.results.some((result) =>
      result.evidence.some((evidence) => /视频 \d.*秒/.test(evidence.location)),
    ),
    "视频结果应引用实际时间点",
  );
  assert.ok(
    videoExecution.results.every((result) => result.verdict !== "passed"),
    "抽样不足不能保证整段完整通过",
  );
  records.push({
    case: "视频时间点与部分覆盖辅助审查",
    status: "passed",
    results: videoExecution.results,
    metadata: videoExecution.metadata,
    ruleCalls: videoRules.modelCalls,
  });
  await rm(directory, { recursive: true, force: true });
} finally {
  for (const id of taskIds) await fetch(origin + "/api/tasks/" + id, { method: "DELETE" });
  await mkdir(".local-data/new-capability-results", { recursive: true });
  await writeFile(
    ".local-data/new-capability-results/latest.json",
    JSON.stringify(
      {
        time: new Date().toISOString(),
        buildId: (await readFile(".next/BUILD_ID", "utf8")).trim(),
        records,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(records.map(({ case: name, status }) => ({ name, status }))));
