import { createCanvas } from "@napi-rs/canvas";
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { once } from "node:events";
import {
  test,
  expect,
  createTask,
  testDirectory,
  password,
  draft,
  noticeContent,
  publish,
  unique,
} from "../helpers/platform-boundaries";
import type { APIRequestContext } from "@playwright/test";
import type { ReviewTaskDetails, ReviewExecution } from "../../src/domain/review";
import type { ReviewRuleSet } from "../../src/domain/review-rule";

async function details(api: APIRequestContext, id: string): Promise<ReviewTaskDetails> {
  return (await (await api.get(`/api/tasks/${id}`)).json()).task;
}
async function upload(
  api: APIRequestContext,
  id: string,
  name: string,
  buffer: Buffer,
  mimeType = "text/plain",
): Promise<void> {
  const response = await api.post(`/api/tasks/${id}/materials`, {
    multipart: { files: { name, buffer, mimeType } },
  });
  expect(response.status(), await response.text()).toBe(201);
}
async function check(api: APIRequestContext, id: string): Promise<ReviewExecution> {
  const response = await api.post(`/api/tasks/${id}/checks?full=1`);
  await response.text();
  expect(response.status()).toBe(200);
  return (await (await api.get(`/api/tasks/${id}/checks`)).json()).executions[0];
}

test("CAP03 真实保存别名映射、拒绝伪证据/越权，修订触发待复检", async ({ actors }) => {
  const api = actors.student.api,
    id = await createTask(actors.student);
  const initial = await details(api, id);
  expect(
    (
      await api.patch(`/api/tasks/${id}`, {
        data: {
          name: initial.name,
          noticeText: "材料中字段“负责人”必须一致。",
          background: { collaborationScope: "individual" },
        },
      })
    ).status(),
  ).toBe(200);
  await upload(api, id, "a.txt", Buffer.from("申请人：张三"));
  await upload(api, id, "b.txt", Buffer.from("负责人：张三"));
  const task = await details(api, id);
  const mappings = task.materials.map((material) => ({
    subject: "报名主体A",
    canonicalField: "负责人",
    materialId: material.id,
    materialVersion: 1,
    segmentIndex: 0,
    sourceField: material.originalFileName === "a.txt" ? "申请人" : "负责人",
    rawValue: "张三",
    note: "逐份核对报名主体编号",
  }));
  const endpoint = `/api/tasks/${id}/field-mappings`;
  expect(
    (await actors.peer.api.post(endpoint, { data: { expected: "[]", mappings } })).status(),
  ).toBe(404);
  expect(
    (
      await api.post(endpoint, {
        data: { expected: "[]", mappings: [{ ...mappings[0], rawValue: "伪造文字" }] },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await api.post(endpoint, {
        data: { expected: "[]", mappings: [{ ...mappings[0], confirmedBy: "spoofed" }] },
      })
    ).status(),
  ).toBe(400);
  expect((await api.post(endpoint, { data: { expected: "[]", mappings } })).status()).toBe(200);
  expect((await api.post(endpoint, { data: { expected: "[]", mappings } })).status()).toBe(409);
  const saved = await details(api, id);
  expect(
    saved.background.fieldMappings?.every((mapping) => mapping.confirmedBy === actors.student.id),
  ).toBe(true);
  const created = await api.post(`/api/tasks/${id}/rules`);
  expect(created.status()).toBe(201);
  const ruleSet: ReviewRuleSet = (await created.json()).ruleSet;
  const rules = ruleSet.rules.slice(0, 1).map((rule) => ({
    ...rule,
    target: "全部材料",
    strength: "required",
    uncertainty: "",
    applicabilityCondition: "",
    materialIds: task.materials.map((material) => material.id),
    checkability: "deterministic",
    description: "材料中字段“负责人”必须一致。",
  }));
  expect((await api.patch(`/api/tasks/${id}/rules`, { data: { rules } })).status()).toBe(201);
  expect((await check(api, id)).results[0]?.verdict).toBe("passed");
  const target = task.materials[0]!;
  expect(
    (
      await api.post(`/api/tasks/${id}/materials/${target.id}/revision`, {
        data: {
          action: "correction",
          version: 1,
          segmentIndex: 0,
          text: target.extractedText.replace("张三", "王五"),
          note: "原件核对差异",
        },
      })
    ).status(),
  ).toBe(201);
  const prior = (await (await api.get(`/api/tasks/${id}/checks`)).json()).executions[0];
  expect(prior.validity).toBe("needs_recheck");
  expect((await check(api, id)).results[0]?.verdict).toBe("needs_confirmation");
  // Ordinary background edits must not erase or accept forged server-authored confirmations.
  const fresh = await details(api, id);
  expect(
    (
      await api.patch(`/api/tasks/${id}`, {
        data: {
          name: fresh.name,
          noticeText: fresh.noticeSource.originalText,
          background: { projectType: "更新类型", collaborationScope: "individual" },
        },
      })
    ).status(),
  ).toBe(200);
  expect((await details(api, id)).background.fieldMappings).toEqual(saved.background.fieldMappings);
});

test("CAP01 CAP02 实际OCR区域、页图隔离、人工确认、增强采用与历史原件", async ({
  actors,
  page,
}) => {
  test.setTimeout(120000);
  const api = actors.student.api,
    id = await createTask(actors.student),
    canvas = createCanvas(1000, 500),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1000, 500);
  ctx.fillStyle = "black";
  ctx.font = "42px Arial";
  ctx.fillText("STUDENT RECORD", 40, 90);
  ctx.fillText("Equipment", 40, 210);
  ctx.fillText("1000", 700, 210);
  ctx.fillText("Services", 40, 330);
  ctx.fillText("2000", 700, 330);
  const original = canvas.toBuffer("image/png");
  await upload(api, id, "regions.png", original, "image/png");
  const material = (await details(api, id)).materials[0]!,
    segment = material.segments.find((item) => item.region)!;
  expect(segment.region?.status).toBe("candidate");
  const image = `/api/tasks/${id}/materials/${material.id}/image?version=1&page=1`;
  expect((await api.get(image)).headers()["content-type"]).toBe("image/png");
  expect((await actors.peer.api.get(image)).status()).toBe(404);
  expect((await api.get(image.replace("page=1", "page=201"))).status()).toBe(400);
  const revision = `/api/tasks/${id}/materials/${material.id}/revision`;
  const regionInput = {
    action: "region",
    version: 1,
    segmentIndex: segment.segmentIndex,
    note: "对照合成原图核对",
    role: "body",
    recognition: "printed",
    readingOrder: 0,
  };
  expect((await api.post(revision, { data: { ...regionInput, role: "table" } })).status()).toBe(
    400,
  );
  const confirmed = await api.post(revision, { data: regionInput });
  expect(confirmed.status(), await confirmed.text()).toBe(201);
  const second = (await confirmed.json()).material;
  expect(second.segments[segment.segmentIndex].region.reviewedBy).toBe(actors.student.id);
  expect((await api.post(revision, { data: regionInput })).status()).toBe(409);
  expect((await api.get(image)).status()).toBe(200);
  const enhanced = await api.post(revision, {
    data: {
      action: "enhance",
      version: 2,
      note: "对比增强候选后采用",
      processing: {
        rotateDegrees: 0,
        normalize: true,
        sharpen: false,
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    },
  });
  expect(enhanced.status(), await enhanced.text()).toBe(201);
  const third = (await enhanced.json()).material;
  expect(third.version).toBe(3);
  expect(third.revision.imageProcessing.normalize).toBe(true);
  expect(third.revision.imageProcessing.corners).toHaveLength(4);
  expect(
    third.segments.find((item: { region?: { status: string } }) => item.region)?.region.status,
  ).toBe("candidate");
  expect(
    await (await api.get(`/api/tasks/${id}/materials/${material.id}/versions/3?file=1`)).body(),
  ).toEqual(original);
  await page.context().addCookies((await api.storageState()).cookies);
  await page.goto(`/tasks/${id}?view=prepare`);
  await page.getByText("核对内容或选择材料类型", { exact: true }).click();
  await page.getByText("图像区域、阅读顺序与增强核对", { exact: true }).click();
  const imageElement = page.getByAltText(/识别图像，当前选中区域/);
  await expect(imageElement).toBeVisible();
  await expect
    .poll(() => imageElement.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});

test("REL02 完整快照在新服务恢复账号、任务归属、原件、收藏和公告", async ({
  actors,
  playwright,
}) => {
  test.setTimeout(120000);
  const id = await createTask(actors.student);
  await upload(actors.student.api, id, "restore.txt", Buffer.from("RESTORE-SYNTHETIC-ORIGINAL"));
  const content = noticeContent({ title: unique("恢复公告") });
  const notice = await draft(actors.admin, content);
  await publish(actors.admin, notice.id);
  expect(
    (
      await actors.student.api.post(`/api/exams/${notice.id}`, {
        data: { action: "favorite" },
      })
    ).status(),
  ).toBe(200);
  expect((await actors.student.api.post(`/api/tasks/${id}/rules`)).status()).toBe(201);
  const before = await check(actors.student.api, id);
  const suffix = unique("restore"),
    destination = resolve(".local-data/full-backup-e2e", suffix),
    target = resolve(".local-data/full-restore-e2e", suffix);
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["scripts/full-backup.mjs", "backup", "--data-dir", testDirectory(), "--dest", destination],
      { encoding: "utf8" },
    ),
  );
  execFileSync(process.execPath, [
    "scripts/full-backup.mjs",
    "verify",
    "--backup",
    result.directory,
  ]);
  const operation = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "scripts/operations.mjs",
        "--data-dir",
        testDirectory(),
        "--backup-dir",
        destination,
        "--health-url",
        "http://127.0.0.1:3132/api/health",
        "--minimum-free-mib",
        "1",
        "--with-backup",
      ],
      { encoding: "utf8" },
    ),
  );
  expect(
    operation.events.some((event: { type: string }) => event.type === "backup_completed"),
  ).toBe(true);
  expect(operation.summary.serviceAvailable).toBe(true);
  execFileSync(process.execPath, [
    "scripts/full-backup.mjs",
    "restore",
    "--backup",
    result.directory,
    "--target",
    target,
  ]);
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3142"],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        REVIEW_DATA_DIR: target,
        AI_MODE: "mock",
        AI_API_KEY: "",
        REVIEW_AUTH_MODE: "accounts",
        EXAM_SCHEDULER: "off",
      },
      windowsHide: true,
    },
  );
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3142" });
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await api.get("/api/health")).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    expect(
      (
        await api.post("/api/auth/login", { data: { username: actors.student.username, password } })
      ).status(),
    ).toBe(200);
    const history = (await (await api.get(`/api/tasks/${id}/checks`)).json()).executions;
    expect(history[0].id).toBe(before.id);
    expect(history[0].results).toEqual(before.results);
    const restored = await details(api, id),
      material = restored.materials[0]!;
    expect(material.originalFileName).toBe("restore.txt");
    expect(
      await (await api.get(`/api/tasks/${id}/materials/${material.id}/versions/1?file=1`)).body(),
    ).toEqual(Buffer.from("RESTORE-SYNTHETIC-ORIGINAL"));
    expect((await api.get(`/exams/${notice.id}`)).status()).toBe(200);
    const favorites = await api.get("/me");
    expect(favorites.status()).toBe(200);
    expect(await favorites.text()).toContain(content.title);
    const peer = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3142" });
    try {
      expect(
        (
          await peer.post("/api/auth/login", { data: { username: actors.peer.username, password } })
        ).status(),
      ).toBe(200);
      expect((await peer.get(`/api/tasks/${id}`)).status()).toBe(404);
    } finally {
      await peer.dispose();
    }
  } finally {
    await api.dispose();
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
});

import { createServer } from "node:https";
import { request as backendRequest } from "node:http";
import { localTlsIdentity } from "../helpers/local-tls";

test("REL01 本地TLS反代验证Secure会话、跨站拒绝、重启持久化及资源门禁", async ({ playwright }) => {
  test.setTimeout(120000);
  const dataDirectory = resolve(testDirectory(), "tls"),
    origin = "https://127.0.0.1:3144";
  let child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3143"],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        REVIEW_DATA_DIR: dataDirectory,
        AI_MODE: "mock",
        AI_API_KEY: "",
        REVIEW_AUTH_MODE: "accounts",
        EXAM_SCHEDULER: "off",
        APP_PUBLIC_ORIGIN: origin,
      },
      windowsHide: true,
    },
  );
  const proxy = createServer(localTlsIdentity(), (request, response) => {
    const backend = backendRequest(
      {
        hostname: "127.0.0.1",
        port: 3143,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: "127.0.0.1:3144" },
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      },
    );
    backend.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502);
        response.end();
      } else if (!response.writableEnded) response.destroy();
    });
    request.pipe(backend);
  });
  proxy.listen(3144, "127.0.0.1");
  await once(proxy, "listening");
  const api = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await api.get("/api/health")).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    const username = unique("tlsstudent");
    expect(
      (
        await api.post("/api/auth/register", {
          data: { username, password },
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(201);
    const login = await api.post("/api/auth/login", {
      data: { username, password },
      headers: { Origin: origin },
    });
    expect(login.status()).toBe(200);
    const cookie = login.headers()["set-cookie"]!;
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    const created = await api.post("/api/tasks", {
      data: { noticeText: "须提交学籍证明。" },
      headers: { Origin: origin },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).task.id;
    expect(
      (
        await api.post("/api/tasks", {
          data: { noticeText: "恶意来源" },
          headers: { Origin: "https://outside.example.test" },
        })
      ).status(),
    ).toBe(403);
    const browser = await playwright.chromium.launch();
    try {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: await api.storageState(),
      });
      const page = await context.newPage();
      await page.goto(`${origin}/tasks/${id}`);
      await expect(
        page.getByRole("heading", { name: "须提交学籍证明。", exact: true }),
      ).toBeVisible();
      await context.close();
    } finally {
      await browser.close();
    }
    let exited = once(child, "exit");
    child.kill();
    await exited;
    child = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3143"],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          REVIEW_DATA_DIR: dataDirectory,
          AI_MODE: "mock",
          AI_API_KEY: "",
          REVIEW_AUTH_MODE: "accounts",
          EXAM_SCHEDULER: "off",
          APP_PUBLIC_ORIGIN: origin,
        },
        windowsHide: true,
      },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await api.get(`/api/tasks/${id}`)).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    const anonymous = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      expect((await anonymous.get(`/api/tasks/${id}`)).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
    exited = once(child, "exit");
    child.kill();
    await exited;
  } finally {
    await api.dispose();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await new Promise<void>((done, reject) =>
      proxy.close((error) => (error ? reject(error) : done())),
    );
  }
});

import { scanLayouts, scanLayoutImage } from "../fixtures/scan-layouts";
import { createReviewPdf } from "../helpers/pdf-fixture";
import { writeFileSync } from "node:fs";
for (const layout of scanLayouts)
  test(`CAP01 固定扫描样例 ${layout.id}`, async ({ actors }, testInfo) => {
    test.setTimeout(120000);
    const api = actors.student.api,
      id = await createTask(actors.student),
      isPdf = layout.id === "cross-page" || layout.id === "missing";
    const original = isPdf
      ? createReviewPdf(
          layout.id === "missing" ? ["scan", "blank"] : ["scan", "scan"],
          scanLayoutImage(layout, "jpeg"),
        )
      : scanLayoutImage(layout);
    await upload(
      api,
      id,
      `${layout.id}.${isPdf ? "pdf" : "png"}`,
      original,
      isPdf ? "application/pdf" : "image/png",
    );
    const material = (await details(api, id)).materials[0]!,
      regions = material.segments.filter((segment) => segment.region);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.every((segment) => segment.region?.status === "candidate")).toBe(true);
    if (layout.id === "double-column") {
      expect(
        regions.some((segment) => segment.text.includes("LEFT") && segment.text.includes("RIGHT")),
      ).toBe(false);

      expect(regions.some((segment) => segment.region?.role === "header")).toBe(true);
      expect(regions.some((segment) => segment.region?.role === "footer")).toBe(true);
      const sidebar = regions.find((segment) => segment.text.includes("NOTE"))!;
      expect(sidebar).toBeTruthy();
      const response = await api.post(`/api/tasks/${id}/materials/${material.id}/revision`, {
        data: {
          action: "region",
          version: 1,
          segmentIndex: sidebar.segmentIndex,
          note: "对照侧栏固定样例确认",
          role: "sidebar",
          recognition: "printed",
          readingOrder: 100,
        },
      });
      expect(response.status(), await response.text()).toBe(201);
    }
    if (layout.id === "missing")
      expect(material.pageCoverage?.find((page) => page.pageNumber === 2)?.status).not.toBe("read");
    if (layout.id === "merged" || layout.id === "cross-page") {
      let version = 1;
      for (const page of layout.id === "cross-page" ? [1, 2] : [1]) {
        const current = (await details(api, id)).materials[0]!,
          segment = current.segments.find((item) => item.region?.pageNumber === page)!;
        const response = await api.post(`/api/tasks/${id}/materials/${material.id}/revision`, {
          data: {
            action: "region",
            version,
            segmentIndex: segment.segmentIndex,
            note: "按固定合成样例原图核对合并/续表",
            role: "table",
            recognition: "printed",
            readingOrder: 0,
            cell: {
              tableId: "sample-budget",
              row: page,
              column: 1,
              rowSpan: 1,
              columnSpan: 2,
              ...(page === 2 ? { continuesFromPage: 1 } : {}),
            },
          },
        });
        expect(response.status(), await response.text()).toBe(201);
        version++;
      }
      const saved = (await details(api, id)).materials[0]!;
      expect(
        saved.segments.some(
          (segment) =>
            segment.region?.cell?.columnSpan === 2 && segment.region.status === "confirmed",
        ),
      ).toBe(true);
      if (layout.id === "cross-page")
        expect(
          saved.segments.some((segment) => segment.region?.cell?.continuesFromPage === 1),
        ).toBe(true);
    }
    await testInfo.attach(`${layout.id}-original`, {
      body: original,
      contentType: isPdf ? "application/pdf" : "image/png",
    });
    const record = {
      sampleId: layout.id,
      expected: layout.expected,
      materialId: material.id,
      sha256: material.sha256,
      pageCoverage: material.pageCoverage,
      actual: (await details(api, id)).materials[0],
    };
    writeFileSync(
      testInfo.outputPath(`${layout.id}-observations.json`),
      JSON.stringify(record, null, 2),
    );
  });

test("UXR35 多材料自动核对融入审查，原始差异与替换后待复检保留", async ({ actors, page }) => {
  const id = await createTask(actors.student),
    api = actors.student.api;
  await upload(api, id, "申请表.txt", Buffer.from("申请人姓名：张三\n项目名称：合成学习项目"));
  await upload(api, id, "证明.txt", Buffer.from("申请人名字：李四\n项目题目：合成学习项目"));
  expect((await api.post(`/api/tasks/${id}/rules`)).status()).toBe(201);
  const execution = await check(api, id);
  expect(execution.status).toBe("completed");
  const checks = execution.metadata?.materialConsistency || [];
  expect(
    checks.some(
      (item) => item.field === "姓名" && item.verdict === "failed" && item.evidence.length === 2,
    ),
  ).toBe(true);
  expect(checks.some((item) => item.field === "项目名称" && item.verdict === "passed")).toBe(true);
  await page.context().addCookies((await api.storageState()).cookies);
  await page.goto(`/tasks/${id}`);
  await expect(page.getByText("跨材料字段对齐", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "姓名不一致", exact: true })).toBeVisible();
  const task = await details(api, id),
    material = task.materials.find((item) => item.originalFileName === "证明.txt")!;
  const revision = await api.post(`/api/tasks/${id}/materials/${material.id}/revision`, {
    data: {
      action: "correction",
      version: material.version,
      segmentIndex: 0,
      text: "申请人名字：张三\n项目题目：合成学习项目",
      note: "合成测试核对原文后纠正",
    },
  });
  expect(revision.ok(), await revision.text()).toBe(true);
  const historical = (await (await api.get(`/api/tasks/${id}/checks`)).json()).executions[0];
  expect(
    historical.metadata.materialConsistency.some(
      (item: { field: string; verdict: string }) =>
        item.field === "姓名" && item.verdict === "failed",
    ),
  ).toBe(true);
  const next = await check(api, id);
  expect(
    next.metadata?.materialConsistency?.some(
      (item) => item.field === "姓名" && item.verdict === "passed",
    ),
  ).toBe(true);
});
