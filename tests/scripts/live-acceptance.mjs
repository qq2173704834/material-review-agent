import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createReviewPdf } from "../helpers/pdf-fixture.ts";

const origin = "http://127.0.0.1:3120";
const records = [];
async function json(path, init) {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(300_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? String(response.status));
  return body;
}
async function create(notice, background) {
  return (
    await json("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "真实 AT 合成验收", noticeText: notice, background }),
    })
  ).task;
}
async function upload(taskId, name, content, source = false) {
  const form = new FormData();
  form.append(source ? "sourceFile" : "files", new Blob([content]), name);
  return json(`/api/tasks/${taskId}/${source ? "sources" : "materials"}`, {
    method: "POST",
    body: form,
  });
}
async function run(taskId, generate = true) {
  if (generate) await json(`/api/tasks/${taskId}/rules`, { method: "POST" });
  const response = await fetch(origin + `/api/tasks/${taskId}/checks`, {
    method: "POST",
    signal: AbortSignal.timeout(300_000),
  });
  await response.text();
  assert.equal(response.status, 200);
  return (await json(`/api/tasks/${taskId}/checks`)).executions[0];
}
async function scenario(id, perform) {
  try {
    const result = await perform();
    records.push({ id, status: "passed", ...result });
    console.log(id + ": passed");
  } catch (error) {
    records.push({ id, status: "failed", message: error.message });
    console.log(id + ": failed");
  }
  await mkdir(".local-data/quality-results", { recursive: true });
  await writeFile(
    ".local-data/quality-results/live-at.json",
    JSON.stringify({ date: new Date().toISOString(), records }, null, 2),
  );
}
await scenario("AT01-AT02-AT03", async () => {
  const task = await create("必须提交申请书。\n可选提交补充说明。\n团队项目必须提供分工表。", {
    collaborationScope: "individual",
    projectStage: "",
    projectType: "",
  });
  const execution = await run(task.id);
  assert.deepEqual(
    execution.results.map((item) => item.verdict).sort(),
    ["failed", "not_applicable", "not_applicable"].sort(),
  );
  return { taskId: task.id, execution };
});
await scenario("AT04", async () => {
  const task = await create("所有材料必须为 PDF，总页数不超过 1 页。");
  await upload(task.id, "材料.pdf", createReviewPdf(["text", "text"]));
  const execution = await run(task.id);
  assert.ok(
    execution.results.some((item) => item.requirement.includes("页") && item.verdict === "failed"),
  );
  return { taskId: task.id, execution };
});
await scenario("AT07", async () => {
  const task = await create("申请书总页数必须不超过 1 页。");
  await upload(task.id, "补充.txt", "申请书总页数必须至少 3 页。", true);
  const execution = await run(task.id);
  assert.equal(execution.results.length, 2);
  assert.ok(execution.results.every((item) => item.verdict === "needs_confirmation"));
  return { taskId: task.id, execution };
});
await scenario("AT05-AT06-AT09-AT11", async () => {
  const task = await create(
    "全部材料中的项目名称必须一致。\n项目说明必须给出测试样本量，只有标题不符合要求。",
  );
  await upload(task.id, "随意甲.txt", "项目说明\n项目名称：绿色能源\n测试样本量");
  await upload(task.id, "随意乙.txt", "申请书\n项目名称：智慧能源");
  const first = await run(task.id);
  assert.ok(
    first.results.some((item) => /一致/.test(item.requirement) && item.verdict === "failed"),
  );
  assert.ok(
    first.results
      .filter((item) => /样本量|标题/.test(item.requirement))
      .every((item) => item.verdict !== "passed"),
  );
  await upload(task.id, "随意甲.txt", "项目说明\n项目名称：绿色能源\n测试样本量：100。");
  await upload(task.id, "随意乙.txt", "申请书\n项目名称：绿色能源");
  const second = await run(task.id, false);
  assert.ok(second.results.every((item) => item.verdict === "passed"));
  return { taskId: task.id, first, second };
});
await scenario("AT08", async () => {
  const task = await create("所有材料必须给出测试样本量。");
  await upload(task.id, "含未读页.pdf", createReviewPdf(["text", "blank"]));
  const execution = await run(task.id);
  assert.ok(execution.results.length > 0);
  assert.ok(execution.results.every((item) => item.verdict !== "passed"));
  return { taskId: task.id, execution };
});
await scenario("R09-A11-alternative", async () => {
  const task = await create("必须提交项目说明或演示说明，二选一即可，不要求同时提交两份。");
  await upload(
    task.id,
    "任意名称.txt",
    "项目说明\n项目名称：绿色能源\n本项目开发电力监测工具，通过采集传感器读数展示实时电流和用电量。\n提供采集模块、数据处理与展示页面，并完成100次功能测试。",
  );
  const execution = await run(task.id);
  assert.equal(execution.results.length, 1);
  assert.equal(execution.results[0].verdict, "passed");
  return { taskId: task.id, execution };
});
if (records.some((record) => record.status !== "passed")) process.exitCode = 1;
