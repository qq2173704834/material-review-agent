import { expect, test } from "@playwright/test";

import type { APIRequestContext } from "@playwright/test";
import type { ReviewCheckResult, ReviewExecution } from "@/domain/review";
import ExcelJS from "exceljs";
import JSZip from "jszip";

function createSyntheticPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 48 >>\nstream\nBT /F1 12 Tf 20 80 Td (PDF sample text) Tj ET\nendstream",
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
        expect.objectContaining({ verdict: "failed", reason: expect.stringContaining("PDF") }),
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

    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByRole("heading", { name: "确定性检查", exact: true })).toBeVisible();
    await expect(page.getByText("通过 3", { exact: true })).toBeVisible();
    await expect(page.getByText("无法检查 1", { exact: true })).toBeVisible();
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

  test("不存在的页面提供可用返回入口", async ({ page }) => {
    const response = await page.goto("/missing-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "没有找到这个页面" })).toBeVisible();
    await page.getByRole("link", { name: "返回任务列表" }).click();
    await expect(page.getByRole("heading", { name: "我的审查任务" })).toBeVisible();
  });
});
