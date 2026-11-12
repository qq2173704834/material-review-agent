import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3120";
const sourceUrl = "https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF1";
const attachmentUrl =
  "https://www.w3.org/WAI/WCAG22/working-examples/pdf-alt-entry-to-an-image/alt-entry-to-an-image.pdf";
const record = { date: new Date().toISOString(), sourceUrl, attachmentUrl, status: "running" };
async function json(path, method = "GET", body) {
  const response = await fetch(origin + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  if (response.status === 204) return null;
  const value = await response.json();
  assert.ok(response.ok, value.error ?? `HTTP ${response.status}`);
  return value;
}
try {
  const { task } = await json("/api/tasks", "POST", {
    name: "公开附件实际验收",
    noticeText: "公开网页附件导入合成测试。",
  });
  record.taskId = task.id;
  const { source } = await json(`/api/tasks/${task.id}/sources`, "POST", { sourceUrl });
  const endpoint = `/api/tasks/${task.id}/sources/${source.id}/attachments`;
  const listing = await json(endpoint);
  assert.ok(listing.attachments.some((attachment) => attachment.url === attachmentUrl));
  const first = await json(endpoint, "POST", { url: attachmentUrl });
  assert.equal(first.source.sourceUrl, attachmentUrl);
  assert.ok(first.source.originalText.trim());
  assert.ok(first.source.fetchedAt);
  const repeated = await json(endpoint, "POST", { url: attachmentUrl });
  assert.equal(repeated.reused, true);
  assert.equal(first.source.id, repeated.source.id);
  const other = await json("/api/tasks", "POST", {
    name: "附件跨任务隔离验证",
    noticeText: "独立任务。",
  });
  const denied = await fetch(
    `${origin}/api/tasks/${other.task.id}/sources/${source.id}/attachments`,
  );
  assert.equal(denied.status, 404);
  await json(`/api/tasks/${other.task.id}`, "DELETE");
  record.source = first.source;
  record.reused = repeated.reused;
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.error = error.message;
  process.exitCode = 1;
} finally {
  await mkdir(".local-data/quality-results", { recursive: true });
  await writeFile(
    ".local-data/quality-results/attachment-import.json",
    JSON.stringify(record, null, 2),
  );
  console.log(record.status);
}
