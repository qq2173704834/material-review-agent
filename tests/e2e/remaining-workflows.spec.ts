import { test, expect } from "@playwright/test";
import JSZip from "jszip";

test("背景建议、敏感提醒、相似材料与副本包 Q06 N12 M11 E06", async ({ request, page }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "剩余功能验收", noticeText: "必须提交申请书。" },
    })
  ).json();
  const content =
    "申请书\n项目形式：团队\n项目阶段：决赛\n项目类型：能源项目\n邮箱：test@example.com\n" +
    "本项目收集电力传感器数据并分析用量。".repeat(10);
  for (const name of ["甲.txt", "乙.txt"])
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: { files: { name, mimeType: "text/plain", buffer: Buffer.from(content) } },
    });
  const insights = await (await request.get(`/api/tasks/${task.id}/insights`)).json();
  expect(insights.background).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field: "collaborationScope",
        value: "team",
        quote: "项目形式：团队",
      }),
    ]),
  );
  expect(insights.sensitive[0].field).toBe("电子邮箱");
  expect(JSON.stringify(insights.sensitive)).not.toContain("test@example.com");
  expect(insights.similar).toHaveLength(1);
  await page.goto(`/tasks/${task.id}?verdict=all`);
  await page.getByRole("button", { name: "确认采用此背景" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "已人工确认背景建议" })).toBeVisible();
  expect(
    (await (await request.get(`/api/tasks/${task.id}`)).json()).task.background.collaborationScope,
  ).toBe("team");
  await page.getByText("选择提交副本与输出名称", { exact: true }).click();
  await page.getByLabel("副本名称：甲.txt", { exact: true }).fill("自定义申请书.txt");
  await page.getByLabel("包含 乙.txt v1", { exact: true }).uncheck();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前材料副本提交包", exact: true }).click();
  const downloaded = await downloadEvent;
  const customZip = await JSZip.loadAsync(await readFile((await downloaded.path())!));
  expect(await customZip.file("materials/自定义申请书.txt")!.async("string")).toBe(content);
  expect(JSON.parse(await customZip.file("manifest.json")!.async("string")).materials).toHaveLength(
    1,
  );
  const materials = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials;
  const response = await request.post(`/api/tasks/${task.id}/package`, {
    data: {
      materials: materials.map((material: { id: string; version: number }, index: number) => ({
        id: material.id,
        version: material.version,
        name: `copy${index}.txt`,
      })),
    },
  });
  expect(response.status()).toBe(200);
  const zip = await JSZip.loadAsync(await response.body());
  expect(await zip.file("materials/copy0.txt")!.async("string")).toBe(content);
  expect(JSON.parse(await zip.file("manifest.json")!.async("string")).materials).toHaveLength(2);
  expect(
    (
      await request.post(`/api/tasks/${task.id}/package`, {
        data: { materials: [{ id: materials[0].id, version: 1, name: "../escape.txt" }] },
      })
    ).status(),
  ).toBe(400);
  await request.delete(`/api/tasks/${task.id}`);
});

test("安全解包限制越界路径并导入多层材料 M12", async ({ request }) => {
  const { task } = await (
    await request.post("/api/tasks", { data: { name: "解包验收", noticeText: "必须提交说明。" } })
  ).json();
  const nested = new JSZip();
  nested.file("readme.md", "# 项目说明\n包含技术方案。");
  const zip = new JSZip();
  zip.file("folder/申请书.txt", "申请书正文");
  zip.file("nested.zip", await nested.generateAsync({ type: "nodebuffer" }));
  const response = await request.post(`/api/tasks/${task.id}/materials`, {
    multipart: {
      files: {
        name: "材料.zip",
        mimeType: "application/zip",
        buffer: await zip.generateAsync({ type: "nodebuffer" }),
      },
    },
  });
  expect(response.status()).toBe(201);
  expect((await response.json()).materials).toHaveLength(2);
  const unsafe = new JSZip();
  unsafe.file("../outside.txt", "越界");
  const denied = await request.post(`/api/tasks/${task.id}/materials`, {
    multipart: {
      files: {
        name: "危险.zip",
        mimeType: "application/zip",
        buffer: await unsafe.generateAsync({ type: "nodebuffer" }),
      },
    },
  });
  expect(denied.status()).toBe(422);
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials).toHaveLength(
    2,
  );
  await request.delete(`/api/tasks/${task.id}`);
});

test("追问保留原判定、分工记录持久化且拒绝跨任务 O10 V09", async ({ request, page }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "追问分工", noticeText: "必须提交 TXT 文件。" },
    })
  ).json();
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  const execution = (await (await request.get(`/api/tasks/${task.id}/checks`)).json())
    .executions[0];
  const rule = execution.results[0];
  const answer = await request.post(`/api/tasks/${task.id}/questions`, {
    data: { executionId: execution.id, ruleId: rule.ruleId, question: "为什么需要补交？" },
  });
  expect(answer.status()).toBe(200);
  expect((await answer.json()).mode).toBe("mock");
  const todo = (
    await (
      await request.post(`/api/tasks/${task.id}/remediations`, {
        data: { executionId: execution.id, ruleId: rule.ruleId },
      })
    ).json()
  ).remediationTask;
  expect(
    (
      await request.patch(`/api/tasks/${task.id}/remediations`, {
        data: { id: todo.id, assignee: "张同学", note: "负责补齐说明" },
      })
    ).status(),
  ).toBe(200);
  await request.patch(`/api/tasks/${task.id}/remediations`, {
    data: { id: todo.id, status: "in_progress" },
  });
  const saved = (await (await request.get(`/api/tasks/${task.id}/remediations`)).json())
    .remediationTasks[0];
  expect(saved.assignee).toBe("张同学");
  expect(saved.assignmentHistory[0].note).toBe("负责补齐说明");
  const { task: other } = await (
    await request.post("/api/tasks", { data: { name: "隔离任务", noticeText: "必须提交说明。" } })
  ).json();
  expect(
    (
      await request.patch(`/api/tasks/${other.id}/remediations`, {
        data: { id: todo.id, assignee: "越权" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/tasks/${other.id}/questions`, {
        data: { executionId: execution.id, ruleId: rule.ruleId, question: "查询其他任务" },
      })
    ).status(),
  ).toBe(404);
  await page.goto(`/tasks/${task.id}?verdict=all`);
  await expect(page.getByText("负责人/认领：张同学", { exact: true })).toBeVisible();
  await page.getByText("负责人/认领：张同学", { exact: true }).click();
  await page.getByRole("button", { name: "由我认领", exact: true }).click();
  await expect(page.getByText("负责人/认领：本机用户", { exact: true })).toBeVisible();
  expect(
    (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0].results[0]
      .verdict,
  ).toBe("failed");
  await request.delete(`/api/tasks/${task.id}`);
  await request.delete(`/api/tasks/${other.id}`);
});

test("链接导入拒绝本机与跨任务入口 M10 C11", async ({ request }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "链接安全", noticeText: "演示链接必须可访问。" },
    })
  ).json();
  const response = await request.post(`/api/tasks/${task.id}/links`, {
    data: { name: "内网链接", url: "http://127.0.0.1/private" },
  });
  expect(response.status()).toBe(422);
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials).toHaveLength(
    0,
  );
  await request.delete(`/api/tasks/${task.id}`);
});
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

test("真实视频规格、时间证据和范围读取 C12 C16", async ({ request }) => {
  test.skip(process.platform !== "win32", "Windows合成工具；其他平台通过显式媒体工具路径联调。");
  test.setTimeout(120_000);
  const require = createRequire(import.meta.url);
  const directory = await mkdtemp(resolve("work", "video-test-"));
  let taskId: string | undefined;
  try {
    const path = resolve(directory, "demo.mp4");
    execFileSync(
      require.resolve("@ffmpeg-installer/win32-x64/ffmpeg.exe"),
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=320x240:d=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-y",
        path,
      ],
      { windowsHide: true, timeout: 15_000 },
    );
    const bytes = await readFile(path);
    const { task } = await (
      await request.post("/api/tasks", {
        data: { name: "视频规格验收", noticeText: "视频时长不超过3秒。" },
      })
    ).json();
    taskId = task.id;
    const uploaded = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: { files: { name: "demo.mp4", mimeType: "video/mp4", buffer: bytes } },
      timeout: 100_000,
    });
    expect(uploaded.status()).toBe(201);
    const material = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0];
    expect(material.parseStatus, material.parseMessage).toBe("partial");
    expect(material.extractedText).toContain('"width":320');
    expect(
      material.segments.some((segment: { location: string }) =>
        segment.location.includes("视频 0.00 秒"),
      ),
    ).toBe(true);
    const url = `/api/tasks/${task.id}/materials/${material.id}/versions/1?file=1`;
    const part = await request.get(url, { headers: { Range: "bytes=0-31" } });
    expect(part.status()).toBe(206);
    expect(await part.body()).toEqual(bytes.subarray(0, 32));
    expect((await request.get(url, { headers: { Range: "bytes=999999999-" } })).status()).toBe(416);
    await request.post(`/api/tasks/${task.id}/rules`);
    await request.post(`/api/tasks/${task.id}/checks`);
    const result = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0]
      .results[0];
    expect(result.verdict).toBe("passed");
    expect(result.evidence[0].quotedText).toContain("durationSeconds");
  } finally {
    if (taskId) await request.delete(`/api/tasks/${taskId}`);
    await rm(directory, { recursive: true, force: true });
  }
});

test("自定义条件集中确认、保存和复检 Q01 Q02", async ({ request, page }) => {
  const notice = "如使用外部数据且涉及个人信息，必须提交 TXT 文件。";
  const { task } = await (
    await request.post("/api/tasks", { data: { name: "复杂条件", noticeText: notice } })
  ).json();
  try {
    const { ruleSet } = await (await request.post(`/api/tasks/${task.id}/rules`)).json();
    const condition = "如使用外部数据且涉及个人信息";
    const rules = ruleSet.rules.map((rule: Record<string, unknown>) => ({
      ...rule,
      applicabilityCondition: condition,
      uncertainty: "",
      strength: "required",
      applicabilityScope: "unknown",
    }));
    expect((await request.patch(`/api/tasks/${task.id}/rules`, { data: { rules } })).status()).toBe(
      201,
    );
    await page.goto(`/tasks/${task.id}?verdict=all`);
    await page.getByTestId("task-primary-action").click();
    await page.getByLabel("确认条件：" + condition, { exact: true }).selectOption("false");
    await page.getByRole("button", { name: "保存补充信息", exact: true }).click();
    await expect(page.getByLabel("确认条件：" + condition, { exact: true })).toHaveCount(0);
    await request.post(`/api/tasks/${task.id}/checks`);
    let executions = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions;
    expect(executions[0].results[0].verdict).toBe("not_applicable");
    const saved = (await (await request.get(`/api/tasks/${task.id}`)).json()).task;
    expect(saved.background.conditionAnswers[0].applies).toBe(false);
    expect(
      (
        await request.patch(`/api/tasks/${task.id}`, {
          data: {
            name: saved.name,
            description: saved.description,
            noticeText: notice,
            background: {
              ...saved.background,
              conditionAnswers: [{ condition, applies: true, note: "再次确认" }],
            },
          },
        })
      ).status(),
    ).toBe(200);
    await request.post(`/api/tasks/${task.id}/checks`);
    executions = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions;
    expect(executions[0].results[0].verdict).toBe("failed");
  } finally {
    await request.delete(`/api/tasks/${task.id}`);
  }
});

test("指定模板字段与范围边界 C15 C13", async ({ request }) => {
  const samples = [
    {
      notice: "必须遵循指定模板；必填字段：项目名称、负责人；必要章节：技术方案。",
      text: "项目名称：电力系统\n负责人：张三\n技术方案\n包含具体的数据采集方法。",
      verdict: "passed",
    },
    {
      notice: "必须遵循指定模板；必填字段：项目名称、负责人；必要章节：技术方案。",
      text: "项目名称：电力系统\n负责人：待填\n技术方案",
      verdict: "failed",
    },
    {
      notice: "正文从“正文开始”到“正文结束”，不含起止，字数不超过3字。",
      text: "前言很长无需计入\n正文开始\n甲乙丙\n正文结束\n附件也不计入",
      verdict: "passed",
    },
    {
      notice: "正文从“正文开始”到“正文结束”，不含起止，字数不超过3字。",
      text: "正文开始\n甲乙丙丁\n正文结束",
      verdict: "failed",
    },
    { notice: "正文必须不超过3字。", text: "甲乙丙", verdict: "needs_confirmation" },
  ];
  for (const sample of samples) {
    const { task } = await (
      await request.post("/api/tasks", { data: { name: "结构范围", noticeText: sample.notice } })
    ).json();
    try {
      await request.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: { name: "填写.txt", mimeType: "text/plain", buffer: Buffer.from(sample.text) },
        },
      });
      const { ruleSet } = await (await request.post(`/api/tasks/${task.id}/rules`)).json();
      const rule = {
        ...ruleSet.rules[0],
        description: sample.notice,
        target: "全部材料",
        uncertainty: "",
        strength: "required",
        applicabilityCondition: "",
        source: {
          ...ruleSet.rules[0].source,
          quotedText: sample.notice,
          startOffset: 0,
          endOffset: sample.notice.length,
        },
      };
      expect(
        (await request.patch(`/api/tasks/${task.id}/rules`, { data: { rules: [rule] } })).status(),
      ).toBe(201);
      await request.post(`/api/tasks/${task.id}/checks`);
      const result = (await (await request.get(`/api/tasks/${task.id}/checks`)).json())
        .executions[0].results[0];
      expect(result.verdict, sample.notice + result.reason).toBe(sample.verdict);
    } finally {
      await request.delete(`/api/tasks/${task.id}`);
    }
  }
});

test("选用历史原件版本不覆盖旧内容 M11", async ({ request, page }) => {
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "历史有效版本", noticeText: "必须提交 TXT 格式文件。" },
    })
  ).json();
  try {
    for (const text of ["第一版真实内容", "第二版待核对内容"])
      await request.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: { name: "材料.txt", mimeType: "text/plain", buffer: Buffer.from(text) },
        },
      });
    const material = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0];
    expect(material.version).toBe(2);
    await page.goto(`/tasks/${task.id}?verdict=all`);
    await page.getByText("核对内容或选择材料类型", { exact: true }).click();
    await page.getByLabel("修订依据", { exact: true }).fill("本轮正式提交采用第一版");
    await page.getByLabel("采用历史版本", { exact: true }).fill("1");
    await page.getByRole("button", { name: "采用此历史版本并生成新版本", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0].version,
      )
      .toBe(3);
    const saved = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0];
    expect(saved.version).toBe(3);
    expect(saved.extractedText).toBe("第一版真实内容");
    expect(saved.revision.note).toContain("采用历史v1");
    const bytes = await request.get(
      `/api/tasks/${task.id}/materials/${material.id}/versions/3?file=1`,
    );
    expect((await bytes.body()).toString()).toBe("第一版真实内容");
    const previous = await request.get(
      `/api/tasks/${task.id}/materials/${material.id}/versions/2?file=1`,
    );
    expect((await previous.body()).toString()).toBe("第二版待核对内容");
  } finally {
    await request.delete(`/api/tasks/${task.id}`);
  }
});

test("压缩包实际输出、校验与层级限制 M12", async ({ request }) => {
  const { task } = await (
    await request.post("/api/tasks", { data: { name: "解包边界", noticeText: "必须提交材料。" } })
  ).json();
  try {
    const seed = new JSZip();
    seed.file("sample.txt", "safe content".repeat(1000));
    const valid = await seed.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const crc = Buffer.from(valid);
    const central = crc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    crc.writeUInt32LE((crc.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
    const forged = Buffer.from(valid);
    forged.writeUInt32LE(1, central + 24);
    let deep = valid;
    for (let index = 0; index < 3; index++) {
      const zip = new JSZip();
      zip.file("nested.zip", deep);
      deep = await zip.generateAsync({ type: "nodebuffer" });
    }
    const crowded = new JSZip();
    for (let index = 0; index < 101; index++) crowded.file(`item${index}.txt`, "text");
    for (const [index, bytes] of [
      crc,
      forged,
      deep,
      await crowded.generateAsync({ type: "nodebuffer" }),
    ].entries()) {
      const response = await request.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: { name: `unsafe${index}.zip`, mimeType: "application/zip", buffer: bytes },
        },
      });
      expect(response.status(), await response.text()).toBe(422);
      expect(
        (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials,
      ).toHaveLength(0);
    }
  } finally {
    await request.delete(`/api/tasks/${task.id}`);
  }
});
