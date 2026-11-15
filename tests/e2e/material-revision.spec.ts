import { expect, test } from "@playwright/test";
import { createReviewPdf } from "../helpers/pdf-fixture";
import { randomUUID } from "node:crypto";

test("文字修订、恢复、历史证据和重复上传不产生虚假版本 ENG-006 ENG-009", async ({
  request,
  page,
}) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "文字修订", noticeText: "必须提交 TXT 格式文件。" },
    })
  ).json();
  const upload = async (): Promise<{ id: string; version: number }> =>
    (
      await (
        await request.post(`/api/tasks/${task.id}/materials`, {
          multipart: {
            files: {
              name: "证明.txt",
              mimeType: "text/plain",
              buffer: Buffer.from("项目名称：原始识别\n金额：12000"),
            },
          },
        })
      ).json()
    ).materials[0];
  const material = await upload();
  expect((await upload()).version).toBe(1);
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  const endpoint = `/api/tasks/${task.id}/materials/${material.id}/revision`;
  const correction = {
    action: "correction",
    version: 1,
    segmentIndex: 0,
    text: "项目名称：核对后的名称",
    note: "对照原件核对项目名",
  };
  expect(
    (await request.post(endpoint.replace(task.id, randomUUID()), { data: correction })).status(),
  ).toBe(404);
  await page.goto(`/tasks/${task.id}?view=prepare&verdict=all`);
  await page.getByText("核对内容或选择材料类型", { exact: true }).click();
  await page.getByLabel("核对后的文字", { exact: true }).fill(correction.text);
  await page.getByLabel("修订依据", { exact: true }).fill(correction.note);
  await page.getByRole("button", { name: "保存文字修订", exact: true }).click();
  await expect(page.getByText("证明.txt", { exact: true })).toBeVisible();
  const current = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0];
  expect(current.version).toBe(2);
  expect(current.revision.note).toBe(correction.note);
  expect(current.segments[1].text).toBe("金额：12000");
  expect((await request.post(endpoint, { data: correction })).status()).toBe(409);
  const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
  expect(executions[0].validity).toBe("needs_recheck");
  const old = await (
    await request.get(`/api/tasks/${task.id}/materials/${material.id}/versions/1`)
  ).json();
  expect(old.preview.segments[0].text).toBe("项目名称：原始识别");
  const restored = await request.post(endpoint, { data: { action: "restore", version: 2 } });
  expect(restored.status()).toBe(201);
  expect((await restored.json()).material.extractedText).toBe("项目名称：原始识别\n金额：12000");
  await request.delete(`/api/tasks/${task.id}`);
});

test("PDF 单页重试保留其他页，失败不创建解析版本 ENG-006", async ({ request }) => {
  const { task } = await (
    await request.post("/api/tasks", { data: { name: "单页重试", noticeText: "必须提交 PDF。" } })
  ).json();
  const { materials } = await (
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: {
          name: "扫描.pdf",
          mimeType: "application/pdf",
          buffer: createReviewPdf(["text", "blank"]),
        },
      },
    })
  ).json();
  const endpoint = `/api/tasks/${task.id}/materials/${materials[0].id}/revision`;
  const before = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0];
  expect(
    (
      await request.post(endpoint, { data: { action: "retry", version: 1, pageNumber: 2 } })
    ).status(),
  ).toBe(422);
  const retry = await request.post(endpoint, {
    data: { action: "retry", version: 1, pageNumber: 1 },
  });
  expect(retry.status()).toBe(201);
  const after = (await retry.json()).material;
  expect(after.version).toBe(2);
  expect(after.pageCoverage[1]).toEqual(before.pageCoverage[1]);
  expect(after.parseStatus).toBe("partial");
  expect(after.segments[0].text).toBe(before.segments[0].text);
  await request.delete(`/api/tasks/${task.id}`);
});
