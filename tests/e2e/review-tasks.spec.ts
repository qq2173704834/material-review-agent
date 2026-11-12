import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import type { APIRequestContext } from "@playwright/test";
import type { ReviewCheckResult, ReviewExecution } from "@/domain/review";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import Database from "better-sqlite3";

function createSyntheticPdf(pageCount = 1): Buffer {
  const firstContentObject = pageCount + 4;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...Array.from(
      { length: pageCount },
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 ${pageCount + 3} 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`,
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...Array.from({ length: pageCount }, () => {
      const stream = "BT /F1 12 Tf 20 80 Td (PDF sample text) Tj ET";
      return `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content, "binary"));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(content, "binary");
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;
  return Buffer.from(content, "binary");
}

async function createSyntheticDocx(): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  archive.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  archive.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX sample text</w:t></w:r></w:p></w:body></w:document>',
  );
  return archive.generateAsync({ type: "nodebuffer" });
}

function createMultipartBody(
  files: Array<{ name: string; mimeType: string; buffer: Buffer<ArrayBufferLike> }>,
  boundary: string,
): Buffer {
  const parts = files.flatMap((file) => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
    ),
    file.buffer,
    Buffer.from("\r\n"),
  ]);
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

interface CheckSseEvent {
  type: string;
  execution?: ReviewExecution;
  result?: ReviewCheckResult;
}

async function runCheckStream(
  request: APIRequestContext,
  taskId: string,
): Promise<{ status: number; events: CheckSseEvent[]; execution: ReviewExecution }> {
  const response = await request.post(`/api/tasks/${taskId}/checks`);
  const body = await response.text();
  const events = body
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((message) =>
      message
        .split(/\r?\n/)
        .find((line) => line.startsWith("data: "))
        ?.slice(6),
    )
    .filter((data): data is string => Boolean(data))
    .map((data) => JSON.parse(data) as CheckSseEvent);
  const execution = events.find((event) => event.type === "completed")?.execution;
  if (!execution)
    throw new Error("The check event stream did not finish with an execution snapshot.");
  return {
    status: response.status(),
    events,
    execution,
  };
}

test.describe("本地审查任务 ENG-004 / ENG-005", () => {
  test("创建任务、刷新恢复并保存通知新版本", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await page.goto("/");
    await expect(page).toHaveTitle("材料预审工作台");
    await page.getByRole("link", { name: "新建审查任务" }).click();
    await page.getByLabel("任务名称").fill("E2E 合成任务 ENG-004");
    await page.getByLabel("项目类型").fill("合成项目");
    await page.getByLabel("项目阶段").fill("测试阶段");
    await page.getByLabel("参与范围").selectOption("team");
    await page.getByLabel("任务说明").fill("只包含浏览器验收使用的合成数据。");
    await page
      .getByRole("textbox", { name: "通知或要求原文" })
      .fill(
        "合成通知标题\n第一项要求：提交一份说明。\n第二项要求：文件不超过 5 MB。\n可选提供 PDF。\n规格：PDF 格式，文件不超过 5 MB，页数不超过 20 页。",
      );
    await page.getByRole("button", { name: "创建审查任务" }).click();

    await expect(page.getByRole("heading", { name: "E2E 合成任务 ENG-004" })).toBeVisible();
    await expect(page.getByText("版本 1 · 当前版本")).toBeVisible();
    await page.getByRole("button", { name: "从通知生成草稿" }).click();
    await expect(page.getByText("模拟模式", { exact: true })).toBeVisible();
    await expect(page.getByText(/必须.*可用确定性工具检查/).first()).toBeVisible();
    await expect(page.getByText(/字符 7–19/)).toBeVisible();
    await expect(page.getByText(/可选/).first()).toBeVisible();
    await expect(page.locator("ol.divide-y > li")).toHaveCount(6);
    const pageLimitRule = page.locator("ol.divide-y > li").filter({ hasText: "页数不超过 20 页" });
    await expect(pageLimitRule.getByText("页数不超过 20 页", { exact: true })).toBeVisible();
    const initialRuleSetsResponse = await page.request.get(
      page.url().replace(/\/tasks\//, "/api/tasks/") + "/rules",
    );
    expect(initialRuleSetsResponse.ok()).toBe(true);
    const initialRuleSetsBody: unknown = await initialRuleSetsResponse.json();
    expect(JSON.stringify(initialRuleSetsBody)).toContain('"mode":"mock"');
    await page.getByText("查看原文段落位置").click();
    await expect(page.getByText(/字符 0–6/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("项目类型")).toHaveValue("合成项目");
    await expect(page.getByLabel("参与范围")).toHaveValue("team");
    await expect(page.getByRole("textbox", { name: "通知或要求原文" })).toHaveValue(/提交一份说明/);

    await page
      .getByRole("textbox", { name: "通知或要求原文" })
      .fill("修订后的合成通知\n仍然保留旧版本内容。");
    await page.getByLabel("项目阶段").fill("复核阶段");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page.getByText("版本 2 · 当前版本")).toBeVisible();
    const versionOne = page.locator("li.border-l-2").filter({ hasText: "版本 1" });
    await expect(versionOne.locator("p").first()).toContainText("合成通知标题");
    await expect(page.getByLabel("项目阶段")).toHaveValue("复核阶段");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "通知或要求原文" })).toHaveValue(
      /修订后的合成通知/,
    );
    await expect(page.getByText(/通知 v1 的规则草稿/)).toBeVisible();
    await page.getByRole("button", { name: "从通知生成草稿" }).click();
    await expect(page.getByText(/通知 v1 的规则草稿/)).toHaveCount(0);
    await expect(page.getByText(/修订后的合成通知/).first()).toBeVisible();

    const response = await page.request.get("/api/tasks");
    expect(response.ok()).toBe(true);
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).toContain("E2E 合成任务 ENG-004");

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(runtimeErrors).toEqual([]);
  });

  test("从上一版数据库升级并保留原任务和通知", async ({ page, request }) => {
    const taskResponse = await request.get("/api/tasks/00000000-0000-4000-8000-000000000004");
    expect(taskResponse.ok()).toBe(true);
    const body: unknown = await taskResponse.json();
    expect(body).toMatchObject({
      task: {
        name: "E2E 遗留任务 ENG-004",
        background: {
          projectType: "合成项目",
          projectStage: "历史阶段",
          collaborationScope: "team",
        },
        noticeSource: { version: 1, originalText: "遗留版本通知\n提交一份说明。" },
      },
    });

    const ruleSetsResponse = await request.get(
      "/api/tasks/00000000-0000-4000-8000-000000000004/rules",
    );
    expect(ruleSetsResponse.ok()).toBe(true);
    await page.goto("/tasks/00000000-0000-4000-8000-000000000004");
    await expect(page.getByRole("heading", { name: "E2E 遗留任务 ENG-004" })).toBeVisible();
  });

  test("导入文本材料、保留定位并隔离不同任务", async ({ page, request }) => {
    const taskResponse = await request.post("/api/tasks", {
      data: { name: "材料导入合成任务", noticeText: "请提交可审查材料。" },
    });
    expect(taskResponse.status()).toBe(201);
    const taskBody = (await taskResponse.json()) as { task: { id: string } };
    const taskId = taskBody.task.id;

    const uploadFiles: Array<{
      name: string;
      mimeType: string;
      buffer: Buffer<ArrayBufferLike>;
      expectedStatus: string;
    }> = [
      {
        name: "说明.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("第一行说明\n第二行说明", "utf8"),
        expectedStatus: "text_extracted",
      },
      {
        name: "记录.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("名称,数量\n样品,2", "utf8"),
        expectedStatus: "text_extracted",
      },
      {
        name: "伪装.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a pdf", "utf8"),
        expectedStatus: "failed",
      },
    ];
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("规格表");
    worksheet.addRow(["项目", "数量"]);
    worksheet.addRow(["样品", 2]);
    const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const docxBuffer = await createSyntheticDocx();
    uploadFiles.push(
      {
        name: "说明.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: docxBuffer,
        expectedStatus: "text_extracted",
      },
      {
        name: "清单.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: workbookBuffer,
        expectedStatus: "text_extracted",
      },
      {
        name: "一页.pdf",
        mimeType: "application/pdf",
        buffer: createSyntheticPdf(),
        expectedStatus: "text_extracted",
      },
      {
        name: "扫描.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8X8AAAAASUVORK5CYII=",
          "base64",
        ),
        expectedStatus: "ocr_required",
      },
      {
        name: "扫描.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
        expectedStatus: "ocr_required",
      },
    );
    for (const file of uploadFiles) {
      const upload = await request.post(`/api/tasks/${taskId}/materials`, {
        multipart: { files: { name: file.name, mimeType: file.mimeType, buffer: file.buffer } },
      });
      expect(upload.status()).toBe(201);
      const uploadResult = await upload.json();
      expect(uploadResult.materials[0].originalFileName).toBe(file.name);
      expect(uploadResult.materials[0].parseStatus, uploadResult.materials[0].parseMessage).toBe(
        file.expectedStatus,
      );
    }

    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByRole("heading", { name: "审查材料" })).toBeVisible();
    await expect(page.getByText("说明.txt", { exact: true })).toBeVisible();
    await page
      .locator("li")
      .filter({ hasText: "说明.txt" })
      .getByText(/查看 2 个定位片段/)
      .click();
    await expect(page.getByText(/第一行说明/)).toBeVisible();

    const revisedText = await request.post(`/api/tasks/${taskId}/materials`, {
      multipart: {
        files: {
          name: "说明.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("第二版说明", "utf8"),
        },
      },
    });
    expect(revisedText.status()).toBe(201);
    expect(await revisedText.json()).toMatchObject({
      materials: [{ originalFileName: "说明.txt", version: 2 }],
    });

    const detailsResponse = await request.get(`/api/tasks/${taskId}`);
    expect(detailsResponse.ok()).toBe(true);
    const details = await detailsResponse.json();
    expect(details.task.materials).toHaveLength(8);
    expect(details.task.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalFileName: "说明.txt",
          version: 2,
          extractedText: "第二版说明",
        }),
        expect.objectContaining({
          originalFileName: "记录.csv",
          extractedText: "名称 | 数量\n样品 | 2",
        }),
        expect.objectContaining({
          originalFileName: "伪装.pdf",
          parseMessage: "扩展名与 PDF 文件签名不匹配。",
        }),
        expect.objectContaining({
          originalFileName: "说明.docx",
          extractedText: "DOCX sample text",
        }),
        expect.objectContaining({
          originalFileName: "清单.xlsx",
          sheetNames: ["规格表"],
        }),
        expect.objectContaining({
          originalFileName: "一页.pdf",
          pageCount: 1,
          extractedText: "PDF sample text",
        }),
        expect.objectContaining({
          originalFileName: "扫描.png",
          parseStatus: "ocr_required",
          extractedText: "",
        }),
        expect.objectContaining({
          originalFileName: "扫描.jpg",
          parseStatus: "ocr_required",
          extractedText: "",
        }),
      ]),
    );

    await page.locator("#material-files").setInputFiles({
      name: "恢复测试.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("invalid Office package"),
    });
    await page.getByRole("button", { name: "上传 1" }).click();
    const batchResults = page.getByRole("list", { name: "本批上传结果" });
    await expect(batchResults.getByText("解析失败", { exact: true })).toBeVisible();
    await expect(batchResults).toContainText("恢复测试.docx · v1");
    const recovered = await request.post(`/api/tasks/${taskId}/materials`, {
      multipart: {
        files: {
          name: "恢复测试.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: await createSyntheticDocx(),
        },
      },
    });
    expect(await recovered.json()).toMatchObject({
      materials: [{ originalFileName: "恢复测试.docx", version: 2, parseStatus: "text_extracted" }],
    });

    const otherTaskResponse = await request.post("/api/tasks", {
      data: { name: "另一合成任务", noticeText: "另一份通知。" },
    });
    const otherTaskBody = (await otherTaskResponse.json()) as { task: { id: string } };
    const crossTaskUpload = await request.post(`/api/tasks/${otherTaskBody.task.id}/materials`, {
      multipart: {
        files: { name: "越权.txt", mimeType: "text/plain", buffer: Buffer.from("隔离检查") },
      },
    });
    expect(crossTaskUpload.status()).toBe(201);
    const otherDetails = await (await request.get(`/api/tasks/${otherTaskBody.task.id}`)).json();
    expect(otherDetails.task.materials).toHaveLength(1);
    expect(otherDetails.task.materials[0].originalFileName).toBe("越权.txt");
  });

  test("拒绝空文件、超限批次和不完整或损坏的材料", async ({ request }) => {
    const taskResponse = await request.post("/api/tasks", {
      data: { name: "材料边界合成任务", noticeText: "用于测试材料边界。" },
    });
    const taskBody = (await taskResponse.json()) as { task: { id: string } };
    const uploadUrl = `/api/tasks/${taskBody.task.id}/materials`;

    const emptyFile = await request.post(uploadUrl, {
      multipart: { files: { name: "空.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) } },
    });
    expect(emptyFile.status()).toBe(413);

    const oversizedFile = await request.post(uploadUrl, {
      multipart: {
        files: {
          name: "超限.txt",
          mimeType: "text/plain",
          buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 0x61),
        },
      },
    });
    expect(oversizedFile.status()).toBe(413);

    const batchBoundary = "eng006-large-batch";
    const oversizedBatch = await request.post(uploadUrl, {
      data: createMultipartBody(
        ["一", "二", "三"].map((label, index) => ({
          name: `批次${label}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.alloc(17 * 1024 * 1024, 0x61 + index),
        })),
        batchBoundary,
      ),
      headers: { "Content-Type": `multipart/form-data; boundary=${batchBoundary}` },
    });
    expect(oversizedBatch.status()).toBe(413);

    const manyFiles = Array.from({ length: 11 }, (_, index) => ({
      name: `文件-${index}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("synthetic"),
    }));
    const boundary = "eng006-boundary-test";
    const excessiveCount = await request.post(uploadUrl, {
      data: createMultipartBody(manyFiles, boundary),
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(excessiveCount.status()).toBe(400);

    const encryptedOfficeSignature = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00,
    ]);
    const zipBomb = new JSZip();
    zipBomb.file("[Content_Types].xml", "<Types/>");
    zipBomb.file("word/document.xml", "<document/>");
    zipBomb.file("large.bin", Buffer.alloc(101 * 1024 * 1024));
    const zipBombBuffer = await zipBomb.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    expect(zipBombBuffer.byteLength).toBeLessThan(1024 * 1024);

    const invalidFiles = [
      {
        name: "空白.txt",
        buffer: Buffer.from("  \n\r\n", "utf8"),
        expectedMessage: "文件为空或没有可提取文本。",
      },
      { name: "错误编码.txt", buffer: Buffer.from([0xc3, 0x28]), expectedMessage: "" },
      { name: "损坏.pdf", buffer: Buffer.from("%PDF-1.7 damaged", "utf8"), expectedMessage: "" },
      {
        name: "损坏.docx",
        buffer: Buffer.from("PK\u0003\u0004broken office zip"),
        expectedMessage: "",
      },
      {
        name: "损坏.xlsx",
        buffer: Buffer.from("PK\u0003\u0004broken workbook zip"),
        expectedMessage: "",
      },
      { name: "损坏.csv", buffer: Buffer.from([0xc3, 0x28]), expectedMessage: "" },
      {
        name: "损坏.png",
        buffer: Buffer.from("not png"),
        expectedMessage: "扩展名与图片文件签名不匹配。",
      },
      {
        name: "损坏.jpg",
        buffer: Buffer.from("not jpeg"),
        expectedMessage: "扩展名与图片文件签名不匹配。",
      },
      {
        name: "加密.docx",
        buffer: encryptedOfficeSignature,
        expectedMessage: "扩展名与 DOCX 文件签名不匹配",
      },
      {
        name: "超量.docx",
        buffer: zipBombBuffer,
        expectedMessage: "Office 文档解压后超过 100 MiB 安全上限。",
      },
    ];
    for (const file of invalidFiles) {
      const response = await request.post(uploadUrl, {
        multipart: {
          files: { name: file.name, mimeType: "application/octet-stream", buffer: file.buffer },
        },
      });
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body.materials[0].parseStatus).toBe("failed");
      if (file.expectedMessage) {
        expect(body.materials[0].parseMessage).toContain(file.expectedMessage);
      }
    }

    const taskDetails = await (await request.get(`/api/tasks/${taskBody.task.id}`)).json();
    expect(taskDetails.task.materials).toHaveLength(invalidFiles.length);
    expect(
      taskDetails.task.materials.map(
        (material: { originalFileName: string }) => material.originalFileName,
      ),
    ).toEqual(expect.arrayContaining(invalidFiles.map((file) => file.name)));
  });

  test("运行确定性规格检查并持久化结论与材料版本", async ({ page, request }) => {
    const taskResponse = await request.post("/api/tasks", {
      data: {
        name: "确定性检查合成任务",
        noticeText:
          "必须提交 PDF 格式文件。\n文件大小不超过 1 mb。\nPDF 总页数不超过 1 页。\n必须按申请编号命名材料。",
      },
    });
    const { task } = await taskResponse.json();
    const rulesResponse = await request.post(`/api/tasks/${task.id}/rules`);
    expect(rulesResponse.status()).toBe(201);

    const firstRun = await runCheckStream(request, task.id);
    expect(firstRun.status).toBe(200);
    const firstExecution = firstRun.execution;
    expect(firstExecution.status).toBe("completed");
    expect(firstExecution.materialSnapshot).toEqual([]);
    expect(firstExecution.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verdict: "failed",
          reason: expect.stringMatching(/pdf/i),
          source: expect.objectContaining({ quotedText: "必须提交 PDF 格式文件" }),
        }),
        expect.objectContaining({
          verdict: "needs_confirmation",
          reason: expect.stringContaining("尚无材料"),
        }),
        expect.objectContaining({
          verdict: "unable_to_check",
          reason: expect.stringContaining("命名"),
        }),
      ]),
    );

    const uploadResponse = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: {
          name: "proposal.pdf",
          mimeType: "application/pdf",
          buffer: createSyntheticPdf(),
        },
      },
    });
    expect(uploadResponse.status()).toBe(201);
    const secondRun = await runCheckStream(request, task.id);
    expect(secondRun.status).toBe(200);
    const secondExecution = secondRun.execution;
    expect(secondExecution.materialSnapshot).toHaveLength(1);
    expect(secondExecution.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ verdict: "passed", reason: expect.stringContaining("文件类型") }),
        expect.objectContaining({ verdict: "passed", reason: expect.stringContaining("均未超过") }),
        expect.objectContaining({ verdict: "passed", reason: expect.stringContaining("总页数") }),
        expect.objectContaining({
          verdict: "unable_to_check",
          recommendation: expect.stringContaining("人工确认"),
        }),
      ]),
    );
    const persisted = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(persisted.executions).toHaveLength(2);
    expect(persisted.executions[0].materialSnapshot).toEqual(secondExecution.materialSnapshot);
    expect(
      secondExecution.results.find((result: { requirement: string }) =>
        result.requirement.includes("总页数"),
      )?.evidence,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ materialVersion: 1, location: "第 1 页" }),
      ]),
    );

    await page.goto("/");
    await expect(page.getByRole("link", { name: /确定性检查合成任务/ }).first()).toContainText(
      "通过 3 · 未通过 0 · 待确认 0",
    );

    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByRole("heading", { name: "确定性检查", exact: true })).toBeVisible();
    const checkPanel = page.getByRole("region", { name: "确定性检查" });
    await expect(checkPanel.getByText("通过 3", { exact: true })).toBeVisible();
    await expect(checkPanel.getByText("无法检查 1", { exact: true })).toBeVisible();
    await checkPanel.getByLabel("按判定筛选").selectOption("passed");
    await expect(
      checkPanel.getByRole("heading", { name: "R-001 · 必须提交 PDF 格式文件" }),
    ).toBeVisible();
    await expect(checkPanel.getByText("当前筛选没有匹配的检查项。")).toHaveCount(0);
    await checkPanel.getByLabel("按要求强度筛选").selectOption("recommended");
    await expect(checkPanel.getByText("当前筛选没有匹配的检查项。", { exact: true })).toBeVisible();
    await checkPanel.getByLabel("按判定筛选").selectOption("all");
    await checkPanel.getByLabel("按要求强度筛选").selectOption("all");
    await checkPanel.getByLabel("按材料筛选").selectOption({ label: "proposal.pdf · v1" });
    await expect(
      checkPanel.getByRole("heading", { name: "R-001 · 必须提交 PDF 格式文件" }),
    ).toBeVisible();
    await checkPanel.getByLabel("按材料筛选").selectOption("all");
    await page.getByRole("button", { name: "运行检查" }).click();
    await expect(page.getByText("已保留 3 次检查快照。", { exact: true })).toBeVisible();

    const invalidPdfUpload = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: "伪装.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") },
      },
    });
    expect(invalidPdfUpload.status()).toBe(201);
    const invalidPdfRun = await runCheckStream(request, task.id);
    expect(invalidPdfRun.status).toBe(200);
    const invalidPdfExecution = invalidPdfRun.execution;
    expect(invalidPdfExecution.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: "必须提交 PDF 格式文件",
          verdict: "unable_to_check",
          reason: expect.stringContaining("不能只依据扩展名"),
        }),
      ]),
    );
  });

  test("逐项展示真实进度并取消后保留已完成项", async ({ page, request }) => {
    const noticeText = Array.from(
      { length: 80 },
      (_, index) => `必须提交第 ${index + 1} 项材料。`,
    ).join("\n");
    const taskResponse = await request.post("/api/tasks", {
      data: { name: "取消执行合成任务", noticeText },
    });
    const { task } = await taskResponse.json();
    const rulesResponse = await request.post(`/api/tasks/${task.id}/rules`);
    expect(rulesResponse.status()).toBe(201);
    const rulesBody = await rulesResponse.json();
    expect(rulesBody.ruleSet.rules).toHaveLength(80);

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "运行检查" }).click();
    await expect(page.getByText(/已完成 \d+ \/ 80 项/)).toBeVisible();
    await page.getByRole("button", { name: "取消检查" }).click();
    await expect(page.getByText(/已取消，\d+ 项未执行/)).toBeVisible();

    await expect
      .poll(async () => {
        const response = await request.get(`/api/tasks/${task.id}/checks`);
        const payload = await response.json();
        return payload.executions[0]?.status;
      })
      .toBe("cancelled");
    const checks = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(checks.executions[0].results.length).toBeGreaterThan(0);
    expect(checks.executions[0].unexecutedCount).toBeGreaterThan(0);
    expect(checks.executions[0].results.length + checks.executions[0].unexecutedCount).toBe(80);
  });

  test("缺少可选材料不会判定为未通过", async ({ request }) => {
    const taskResponse = await request.post("/api/tasks", {
      data: {
        name: "可选材料边界任务",
        noticeText: "申请人必须提交申请表。\n申请人可以选择提交项目介绍材料。",
      },
    });
    const { task } = await taskResponse.json();
    const rulesResponse = await request.post(`/api/tasks/${task.id}/rules`);
    expect(rulesResponse.status()).toBe(201);

    const run = await runCheckStream(request, task.id);
    const optionalResult = run.execution.results.find((result) =>
      result.requirement.includes("可以选择提交项目介绍"),
    );
    expect(optionalResult).toMatchObject({
      strength: "optional",
      verdict: "not_applicable",
    });
    expect(optionalResult?.reason).toContain("不构成缺失问题");
  });

  test("拒绝空通知、非法任务编号并报告本地 SQLite 状态", async ({ request }) => {
    const invalidJson = await request.post("/api/tasks", { data: { noticeText: "  " } });
    expect(invalidJson.status()).toBe(400);
    expect(await invalidJson.json()).toMatchObject({ error: "请填写通知或项目要求的原文。" });

    const invalidTaskId = await request.get("/api/tasks/not-a-uuid");
    expect(invalidTaskId.status()).toBe(400);

    const missingTask = await request.get("/api/tasks/00000000-0000-4000-8000-000000000000");
    expect(missingTask.status()).toBe(404);

    const taskOne = await request.post("/api/tasks", {
      data: { name: "隔离检查 A", noticeText: "A 项目的合成通知" },
    });
    const taskTwo = await request.post("/api/tasks", {
      data: { name: "隔离检查 B", noticeText: "B 项目的合成通知" },
    });
    expect(taskOne.status()).toBe(201);
    expect(taskTwo.status()).toBe(201);
    const taskOneBody: unknown = await taskOne.json();
    const taskTwoBody: unknown = await taskTwo.json();
    expect(taskOneBody).toMatchObject({
      task: { name: "隔离检查 A", noticeSource: { originalText: "A 项目的合成通知" } },
    });
    expect(taskTwoBody).toMatchObject({
      task: { name: "隔离检查 B", noticeSource: { originalText: "B 项目的合成通知" } },
    });

    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(health.headers()["cache-control"]).toBe("no-store");
    expect(await health.json()).toEqual({
      status: "ok",
      application: "material-review-agent",
      runtime: {
        mode: "mock",
        hasModelConfiguration: false,
        modelIntegration: "implemented",
        storage: "local_sqlite",
      },
    });
  });

  test("删除任务会级联清除数据且不影响其他任务", async ({ request }) => {
    const first = await request.post("/api/tasks", {
      data: { name: "待删除任务", noticeText: "删除范围合成通知" },
    });
    const second = await request.post("/api/tasks", {
      data: { name: "保留任务", noticeText: "保留范围合成通知" },
    });
    const firstTask = (await first.json()).task;
    const secondTask = (await second.json()).task;
    const upload = await request.post(`/api/tasks/${firstTask.id}/materials`, {
      multipart: {
        files: { name: "原件.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic") },
      },
    });
    expect(upload.status()).toBe(201);

    const deletion = await request.delete(`/api/tasks/${firstTask.id}`);
    expect(deletion.status()).toBe(204);
    expect((await request.get(`/api/tasks/${firstTask.id}`)).status()).toBe(404);
    expect(await request.get(`/api/tasks/${secondTask.id}`)).toBeTruthy();
    expect((await request.get(`/api/tasks/${secondTask.id}`)).status()).toBe(200);
  });

  test("人工纠正规则会生成新版本并使旧检查待复检", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "规则纠正任务", noticeText: "必须提交项目说明。" },
    });
    const { task } = await created.json();
    const extracted = await request.post(`/api/tasks/${task.id}/rules`);
    const { ruleSet } = await extracted.json();
    const check = await runCheckStream(request, task.id);
    expect(check.status).toBe(200);

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "人工纠正" }).first().click();
    await page.getByLabel("要求描述").fill("人工核对后的项目说明要求");
    await page.getByLabel("识别参数（每行一项）").fill("项目名称\n负责人");
    await page.getByRole("button", { name: "保存为新版本" }).click();
    await expect(page.getByText("人工核对后的项目说明要求")).toBeVisible();

    const savedBody = await (await request.get(`/api/tasks/${task.id}/rules`)).json();
    const editedRuleSet = savedBody.ruleSets[0];
    expect(editedRuleSet.rules[0]).toMatchObject({
      description: "人工核对后的项目说明要求",
      parameters: ["项目名称", "负责人"],
      generationMethod: "manual",
      source: ruleSet.rules[0].source,
    });
    expect(editedRuleSet.id).not.toBe(ruleSet.id);

    const checks = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(checks.executions[0].validity).toBe("needs_recheck");
    expect(checks.executions[0].invalidationReasons).toContain("规则草稿已经更新");

    const forgedRules = editedRuleSet.rules.map((rule: { source: { quotedText: string } }) => ({
      ...rule,
      source: { ...rule.source, quotedText: "不存在于通知的引用" },
    }));
    const forged = await request.patch(`/api/tasks/${task.id}/rules`, {
      data: { rules: forgedRules },
    });
    expect(forged.status()).toBe(422);
  });

  test("停用规则会创建空的当前版本并保留上一版本", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "规则停用任务", noticeText: "必须提交项目说明。" },
    });
    const { task } = await created.json();
    const extracted = await request.post(`/api/tasks/${task.id}/rules`);
    expect(extracted.status()).toBe(201);

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "停用规则" }).first().click();
    await expect(page.getByRole("button", { name: "停用规则" })).toHaveCount(0);

    const { ruleSets } = await (await request.get(`/api/tasks/${task.id}/rules`)).json();
    expect(ruleSets).toHaveLength(2);
    expect(ruleSets[0].rules).toEqual([]);
    expect(ruleSets[1].rules).toHaveLength(1);
  });

  test("人工新增规则必须引用当前通知原文并作为新版本保存", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: {
        name: "人工新增规则任务",
        noticeText: "必须提交项目说明。另需提供签章页原件。",
      },
    });
    const { task } = await created.json();
    await request.post(`/api/tasks/${task.id}/rules`);
    const before = await (await request.get(`/api/tasks/${task.id}/rules`)).json();
    const previousCount = before.ruleSets[0].rules.length;

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "新增人工规则" }).click();
    await page.getByLabel("要求描述").last().fill("补充核对签章页原件");
    await page.getByLabel("目标材料").last().fill("签章页原件");
    await page.getByLabel("通知原文引用").fill("另需提供签章页原件。");
    await page.getByRole("button", { name: "保存为新规则版本" }).click();

    const { ruleSets } = await (await request.get(`/api/tasks/${task.id}/rules`)).json();
    expect(ruleSets[0].rules).toHaveLength(previousCount + 1);
    expect(ruleSets[0].rules.at(-1)).toMatchObject({
      description: "补充核对签章页原件",
      target: "签章页原件",
      generationMethod: "manual",
      source: { quotedText: "另需提供签章页原件。" },
    });
    expect(ruleSets[1].rules).toHaveLength(previousCount);
  });

  test("人工匹配将选中的材料绑定到新规则版本并限制检查范围", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "材料匹配任务", noticeText: "必须提交项目说明。" },
    });
    const { task } = await created.json();
    const extraction = await request.post(`/api/tasks/${task.id}/rules`);
    const { ruleSet } = await extraction.json();
    const upload = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: {
          name: "正确材料.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("项目说明：实际内容"),
        },
      },
    });
    const uploaded = await upload.json();
    const selected = uploaded.materials[0];
    const unrelatedResponse = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: "无关材料.txt", mimeType: "text/plain", buffer: Buffer.from("其他信息") },
      },
    });
    const unrelated = (await unrelatedResponse.json()).materials[0];

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "人工纠正" }).first().click();
    await page.getByLabel("正确材料.txt · v1").check();
    await page.getByRole("button", { name: "保存为新版本" }).click();

    const { ruleSets } = await (await request.get(`/api/tasks/${task.id}/rules`)).json();
    expect(ruleSets[0].rules[0].materialIds).toEqual([selected.id]);
    const checked = await runCheckStream(request, task.id);
    const semanticResult = checked.execution.results.find(
      (result: { ruleCode: string }) => result.ruleCode === ruleSet.rules[0].code,
    );
    expect(
      semanticResult?.evidence.map((evidence: { materialId: string }) => evidence.materialId),
    ).not.toContain(unrelated.id);

    const crossTask = await request.post("/api/tasks", {
      data: { name: "其他任务", noticeText: "必须提交项目材料。" },
    });
    const { task: otherTask } = await crossTask.json();
    const otherRules = await (await request.post(`/api/tasks/${otherTask.id}/rules`)).json();
    const forged = await request.patch(`/api/tasks/${otherTask.id}/rules`, {
      data: {
        rules: otherRules.ruleSet.rules.map((rule: object) => ({
          ...rule,
          materialIds: [selected.id],
        })),
      },
    });
    expect(forged.status()).toBe(422);
  });

  test("人工复核意见独立保存，不覆盖系统判定", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "人工复核记录", noticeText: "提交的PDF总页数不超过2页。" },
    });
    const { task } = await created.json();
    await request.post(`/api/tasks/${task.id}/rules`);
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: "说明.txt", mimeType: "text/plain", buffer: Buffer.from("项目说明概要") },
      },
    });
    const checked = await runCheckStream(request, task.id);
    const target = checked.execution.results.find(
      (result: { verdict: string }) => result.verdict === "needs_confirmation",
    );
    if (!target) throw new Error("Expected a result that requires human confirmation.");

    await page.goto(`/tasks/${task.id}`);
    await page.getByLabel(`${target.ruleCode} 人工复核意见`).selectOption("confirmed");
    await page.getByLabel(`${target.ruleCode} 复核依据`).fill("人工对照原文及材料后确认");
    await page.getByRole("button", { name: "保存意见" }).click();
    await expect(
      page.getByText("已保存人工意见：认为符合 · 人工对照原文及材料后确认"),
    ).toBeVisible();

    const history = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    const persisted = history.executions[0];
    expect(
      persisted.results.find((result: { ruleId: string }) => result.ruleId === target.ruleId)
        .verdict,
    ).toBe("needs_confirmation");
    expect(persisted.humanResolutions).toEqual([
      expect.objectContaining({
        ruleId: target.ruleId,
        decision: "confirmed",
        note: "人工对照原文及材料后确认",
      }),
    ]);
    const report = await request.get(
      `/api/tasks/${task.id}/report?executionId=${checked.execution.id}`,
    );
    expect(await report.text()).toContain("人工复核意见：认为符合 · 人工对照原文及材料后确认");
    const remediation = await request.get(
      `/api/tasks/${task.id}/report?executionId=${checked.execution.id}&type=remediation`,
    );
    expect(await remediation.text()).toContain("人工意见独立于系统判定");

    const missingNote = await request.patch(`/api/tasks/${task.id}/checks/resolutions`, {
      data: { executionId: checked.execution.id, ruleId: target.ruleId, decision: "rejected" },
    });
    expect(missingNote.status()).toBe(400);
  });

  test("明确失败项可创建整改待办且完成状态不替代复检", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "整改待办任务", noticeText: "文件名必须为“申请书.pdf”。" },
    });
    const { task } = await created.json();
    await request.post(`/api/tasks/${task.id}/rules`);
    const checked = await runCheckStream(request, task.id);
    const failed = checked.execution.results[0];
    if (!failed) throw new Error("Expected the missing required filename to fail.");
    expect(failed).toMatchObject({ verdict: "failed", strength: "required" });

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "创建整改待办" }).click();
    const todoStatus = page.getByLabel("R-001 整改待办状态");
    await expect(todoStatus).toBeVisible();
    await todoStatus.selectOption("done");

    const todos = await (await request.get(`/api/tasks/${task.id}/remediations`)).json();
    expect(todos.remediationTasks).toHaveLength(1);
    expect(todos.remediationTasks[0]).toMatchObject({
      executionId: checked.execution.id,
      ruleId: failed.ruleId,
      ruleCode: "R-001",
      status: "done",
    });
    const history = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(history.executions[0].results[0].verdict).toBe("failed");
  });

  test("集中补充团队与阶段条件后保存背景并更新适用性", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "集中澄清任务", noticeText: "团队项目在初赛阶段必须提交成员说明文件。" },
    });
    const { task } = await created.json();
    await request.post(`/api/tasks/${task.id}/rules`);
    const initial = await runCheckStream(request, task.id);
    expect(initial.execution.results[0]?.verdict).toBe("needs_confirmation");

    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByRole("heading", { name: "需要补充的信息" })).toBeVisible();
    await page.getByLabel("补充参与范围").selectOption("team");
    await page.getByLabel("补充项目阶段").fill("初赛");
    await page.getByRole("button", { name: "保存补充信息" }).click();

    const saved = (await (await request.get(`/api/tasks/${task.id}`)).json()).task;
    expect(saved.background).toMatchObject({ collaborationScope: "team", projectStage: "初赛" });
    const history = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(history.executions[0].validity).toBe("needs_recheck");
    const refreshed = await runCheckStream(request, task.id);
    expect(refreshed.execution.results[0]?.verdict).toBe("failed");
    expect(refreshed.execution.results[0]?.reason).not.toContain("背景不足");
  });

  test("公开网页来源拒绝访问本机网络地址并保留粘贴替代入口", async ({ page }) => {
    await page.goto("/tasks/new");
    await page.getByRole("button", { name: "公开网页" }).click();
    for (const url of [
      "http://127.0.0.1/api/health",
      "http://10.0.0.1/",
      "http://[::1]/",
      "http://[2002:0a00:0001::1]/",
    ]) {
      await page.getByLabel("网页 URL").fill(url);
      await page.getByRole("button", { name: "读取网页并创建任务" }).click();
      await expect(page.locator('p[role="alert"]')).toContainText("非公开网络");
    }
    await expect(page.getByRole("button", { name: "粘贴文本" })).toBeVisible();
  });

  test("从 PDF、DOCX、TXT 导入要求文件并保留真实位置", async ({ request, page }) => {
    const docx = await createSyntheticDocx();
    const files = [
      { name: "通知.txt", mimeType: "text/plain", buffer: Buffer.from("通知标题\nTXT 要求正文。") },
      {
        name: "通知.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: docx,
      },
      { name: "通知.pdf", mimeType: "application/pdf", buffer: createSyntheticPdf(2) },
    ];

    for (const file of files) {
      const response = await request.post("/api/tasks", {
        multipart: {
          sourceFile: file,
          name: `来源文件 ${file.name}`,
          description: "合成要求文件导入验证",
          background: JSON.stringify({
            projectType: "",
            projectStage: "",
            collaborationScope: "unknown",
          }),
        },
      });
      expect(response.status()).toBe(201);
      const { task } = await response.json();
      expect(task.noticeSource.inputType).toBe("file");
      expect(task.noticeSource.displayName).toBe(file.name);
      expect(task.noticeSource.parseStatus).toBe("text_extracted");
      expect(task.noticeSource.originalText.length).toBeGreaterThan(0);
      expect(task.noticeSource.segments.length).toBeGreaterThan(0);
      if (file.name.endsWith(".pdf")) {
        expect(task.noticeSource.segments[0].location).toBe("第 1 页");
        expect(task.noticeSource.segments[1].location).toBe("第 2 页");
      }
      if (file.name.endsWith(".txt")) expect(task.noticeSource.segments[1].location).toBe("行 2");

      const restored = (await (await request.get(`/api/tasks/${task.id}`)).json()).task;
      expect(restored.noticeSource.originalText).toBe(task.noticeSource.originalText);
      expect(
        restored.noticeSource.segments.map((segment: { location?: string }) => segment.location),
      ).toEqual(
        task.noticeSource.segments.map((segment: { location?: string }) => segment.location),
      );
    }

    await page.goto("/tasks/new");
    await page.getByRole("button", { name: "上传文件" }).click();
    await expect(page.getByLabel("要求文件")).toHaveAttribute("accept", /\.pdf/);
  });

  test("复制任务只复用通知与背景，不继承材料和检查结论", async ({ request }) => {
    const created = await request.post("/api/tasks", {
      data: {
        name: "来源任务",
        description: "合成任务说明",
        background: { projectType: "科研", projectStage: "申报", collaborationScope: "team" },
        noticeText: "必须提交项目说明。",
      },
    });
    const { task } = await created.json();
    await request.post(`/api/tasks/${task.id}/rules`);
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: "说明.txt", mimeType: "text/plain", buffer: Buffer.from("合成内容") },
      },
    });
    await runCheckStream(request, task.id);

    const cloneResponse = await request.post(`/api/tasks/${task.id}/clone`);
    expect(cloneResponse.status()).toBe(201);
    const { task: clone } = await cloneResponse.json();
    expect(clone).toMatchObject({
      name: "来源任务（副本）",
      description: "合成任务说明",
      background: task.background,
      noticeSource: { originalText: task.noticeSource.originalText },
      materials: [],
    });
    expect(clone.id).not.toBe(task.id);
    expect(
      (await (await request.get(`/api/tasks/${clone.id}/rules`)).json()).ruleSets,
    ).toHaveLength(0);
    expect(
      (await (await request.get(`/api/tasks/${clone.id}/checks`)).json()).executions,
    ).toHaveLength(0);
  });

  test("仅对通知给出固定文件名的规则执行精确名称检查", async ({ request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "固定命名规则", noticeText: "文件名必须为“申请书.pdf”。" },
    });
    const { task } = await created.json();
    const rules = await request.post(`/api/tasks/${task.id}/rules`);
    expect((await rules.json()).ruleSet.rules).toHaveLength(1);

    const missing = await runCheckStream(request, task.id);
    expect(missing.execution.results[0]).toMatchObject({ verdict: "failed" });

    const upload = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: {
          name: "申请书.pdf",
          mimeType: "application/pdf",
          buffer: createSyntheticPdf(),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const valid = await runCheckStream(request, task.id);
    expect(valid.execution.results[0]).toMatchObject({
      verdict: "passed",
      reason: expect.stringContaining("固定名称"),
    });
  });

  test("团队限定规则对个人项目不适用且未知背景待确认", async ({ request }) => {
    const createWithScope = async (scope: "individual" | "unknown"): Promise<string> => {
      const created = await request.post("/api/tasks", {
        data: {
          name: `团队限定-${scope}`,
          background: { projectType: "", projectStage: "", collaborationScope: scope },
          noticeText: "团队项目必须提交成员分工表。",
        },
      });
      const { task } = await created.json();
      const rules = await request.post(`/api/tasks/${task.id}/rules`);
      expect((await rules.json()).ruleSet.rules[0]).toMatchObject({ applicabilityScope: "team" });
      return task.id as string;
    };

    const individualTaskId = await createWithScope("individual");
    const individual = await runCheckStream(request, individualTaskId);
    expect(individual.execution.results[0]).toMatchObject({ verdict: "not_applicable" });

    const unknownTaskId = await createWithScope("unknown");
    const unknown = await runCheckStream(request, unknownTaskId);
    expect(unknown.execution.results[0]).toMatchObject({ verdict: "needs_confirmation" });
  });

  test("同一材料互斥的页数边界会提示冲突原文", async ({ page, request }) => {
    const created = await request.post("/api/tasks", {
      data: {
        name: "页数冲突样例",
        noticeText: "项目说明至少12页。\n项目说明最多10页。",
      },
    });
    const { task } = await created.json();
    const response = await request.post(`/api/tasks/${task.id}/rules`);
    const { ruleSet } = await response.json();
    expect(ruleSet.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "conflicting_constraints",
          message: expect.stringContaining("至少12页"),
        }),
      ]),
    );
    expect(ruleSet.warnings[0].message).toContain("最多10页");

    const compatible = await request.post("/api/tasks", {
      data: {
        name: "相容页数边界样例",
        noticeText: "项目说明至少8页。\n项目说明最多12页。",
      },
    });
    const { task: compatibleTask } = await compatible.json();
    const compatibleRules = await request.post(`/api/tasks/${compatibleTask.id}/rules`);
    expect((await compatibleRules.json()).ruleSet.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "conflicting_constraints" })]),
    );

    await page.goto(`/tasks/${task.id}`);
    await page.getByText(/需要人工留意的信息/).click();
    await expect(page.getByText(/两处原文/)).toBeVisible();
  });

  test("PDF 总页数上限的精确边界值通过且超出一页失败", async ({ request }) => {
    const created = await request.post("/api/tasks", {
      data: {
        name: "PDF 页数边界",
        noticeText: "PDF总页数不超过2页。",
      },
    });
    const { task } = await created.json();
    const rules = await request.post(`/api/tasks/${task.id}/rules`);
    expect(rules.status()).toBe(201);

    const atLimit = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: {
          name: "项目说明.pdf",
          mimeType: "application/pdf",
          buffer: createSyntheticPdf(2),
        },
      },
    });
    expect((await atLimit.json()).materials[0]).toMatchObject({ parseStatus: "text_extracted" });
    const passing = await runCheckStream(request, task.id);
    expect(passing.execution.results[0]).toMatchObject({ verdict: "passed" });
    expect(passing.execution.results[0]?.reason).toContain("均不超过 2 页");

    const overLimit = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: {
          name: "项目说明.pdf",
          mimeType: "application/pdf",
          buffer: createSyntheticPdf(3),
        },
      },
    });
    expect((await overLimit.json()).materials[0]).toMatchObject({
      version: 2,
      parseStatus: "text_extracted",
    });
    const failing = await runCheckStream(request, task.id);
    expect(failing.execution.results[0]).toMatchObject({ verdict: "failed" });
    expect(failing.execution.results[0]?.reason).toContain("3 页");
  });

  test("SQLite 保存失败时回收本次上传原件", async ({ request }) => {
    const created = await request.post("/api/tasks", {
      data: { name: "文件回收故障注入", noticeText: "用于验证保存失败清理。" },
    });
    const { task } = await created.json();
    const triggerName = `reject_upload_${task.id.replaceAll("-", "")}`;
    const database = new Database(resolve(process.cwd(), ".local-data/e2e/reviews.sqlite"));
    database.exec(`CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON review_material_versions
      WHEN NEW.original_file_name = 'force-db-error.txt'
      BEGIN SELECT RAISE(ABORT, 'synthetic save failure'); END;`);
    try {
      const response = await request.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: {
            name: "force-db-error.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("synthetic"),
          },
        },
      });
      expect(response.status()).toBe(500);
      expect(await response.json()).toMatchObject({
        error: "材料元数据保存失败，本次上传未完成。",
      });
      expect(
        readdirSync(resolve(process.cwd(), `.local-data/e2e/materials/${task.id}`)),
      ).toHaveLength(0);
      expect(
        (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials,
      ).toHaveLength(0);
    } finally {
      database.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
      database.close();
    }
  });

  test("不存在的页面提供可用返回入口", async ({ page }) => {
    const response = await page.goto("/missing-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "没有找到这个页面" })).toBeVisible();
    await page.getByRole("link", { name: "返回任务列表" }).click();
    await expect(page.getByRole("heading", { name: "我的审查任务" })).toBeVisible();
  });
});
