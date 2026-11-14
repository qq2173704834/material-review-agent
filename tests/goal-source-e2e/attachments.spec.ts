import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";

test("目标读取真实官方PDF后双来源提规则，未读拦截、重复导入和账号隔离", async ({
  request,
  playwright,
}) => {
  const directory = resolve(process.env.REVIEW_GOAL_SOURCE_DATA_DIR ?? "");
  if (!directory.startsWith(resolve(".local-data/goal-source-e2e") + sep))
    throw new Error("只允许独立测试目录。");
  const username = `goalpdf_${randomUUID().slice(0, 8)}`,
    password = "Synthetic-Goal-Pdf-2026!";
  expect(
    (await request.post("/api/auth/register", { data: { username, password } })).status(),
  ).toBe(201);
  execFileSync(process.execPath, [
    "scripts/platform-admin.mjs",
    "role",
    "--username",
    username,
    "--role",
    "admin",
    "--apply",
    "--data-dir",
    directory,
  ]);
  expect((await request.post("/api/auth/login", { data: { username, password } })).status()).toBe(
    200,
  );
  const sources = (await (await request.get("/api/admin/exams")).json()).sources;
  const source = sources.find(
    (entry: { url: string }) => entry.url === "https://ncre.neea.edu.cn/",
  );
  const url = "https://ncre.neea.edu.cn/html1/report/2412/185-1.htm";
  const draft = await request.post("/api/admin/exams", {
    data: {
      action: "draft",
      sourceId: source.id,
      url,
      content: {
        title: "合成目标任务：真实NCRE附件读取专项",
        category: "ncre",
        region: "全国",
        edition: "2027年合成测试",
        year: 2027,
        stage: "其他",
        organizer: "合成测试",
        publishedAt: "2026-11-14",
        text: "合成隔离前置：须提交学籍证明。此条不是实际报名通知，附件读取指向公开NCRE官方大纲页。",
        summary: "仅用于隔离测试",
        audience: "仅合成测试",
        timeline: [],
        attachments: [],
        disposition: "正常",
      },
    },
  });
  expect(draft.status(), await draft.text()).toBe(200);
  const id = (await draft.json()).id;
  expect(
    (
      await request.post("/api/admin/exams", { data: { action: "publish", id, version: 1 } })
    ).status(),
  ).toBe(200);
  const goal = (
    await (
      await request.post("/api/goals", {
        data: {
          goal: { category: "ncre", region: "全国", edition: "2027年合成测试", noticeId: id },
        },
      })
    ).json()
  ).goal;
  const bind = await request.post("/api/goals/review", { data: { goalId: goal.id, auto: false } });
  expect(bind.status(), await bind.text()).toBe(200);
  const { taskId } = await bind.json();
  const task = (await (await request.get(`/api/tasks/${taskId}`)).json()).task;
  const endpoint = `/api/tasks/${taskId}/sources/${task.noticeSource.id}/attachments`;
  const discovery = await request.get(endpoint, { timeout: 30000 });
  expect(discovery.status(), await discovery.text()).toBe(200);
  const attachments = (await discovery.json()).attachments;
  expect(attachments.length).toBeGreaterThan(0);
  const attachment = attachments.find((entry: { url: string }) => entry.url.includes(".pdf"));
  expect(attachment).toBeTruthy();
  // Record just the selected, genuinely linked official PDF as required by the synthetic notice.
  const adminEntry = (await (await request.get("/api/admin/exams")).json()).notices.find(
    (entry: { id: string }) => entry.id === id,
  );
  const update = await request.post("/api/admin/exams", {
    data: {
      action: "draft",
      sourceId: source.id,
      url,
      content: {
        ...adminEntry.content,
        attachments: [{ ...attachment, status: "仅官方链接，未读取" }],
      },
    },
  });
  expect(update.status(), await update.text()).toBe(200);
  expect(
    (
      await request.post("/api/admin/exams", { data: { action: "publish", id, version: 2 } })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post("/api/goals/review", {
        data: { goalId: goal.id, auto: true, adopt: true },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await request.post("/api/goals/review", { data: { goalId: goal.id, auto: true } })).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`/api/tasks/${taskId}/materials`, {
        multipart: {
          files: {
            name: "合成学籍.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("合成学籍证明：仅测试，不是实际考生材料。"),
          },
        },
      })
    ).status(),
  ).toBe(201);
  const pageBefore = await (await request.get(`/me/goals/${goal.id}`)).text();
  expect(pageBefore).toContain("公告附件尚未读取");
  const peer = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3146" });
  try {
    const peerName = `peerpdf_${randomUUID().slice(0, 8)}`;
    await peer.post("/api/auth/register", { data: { username: peerName, password } });
    await peer.post("/api/auth/login", { data: { username: peerName, password } });
    expect((await peer.post(endpoint, { data: { url: attachment.url } })).status()).toBe(404);
    const imported = await request.post(endpoint, {
      data: { url: attachment.url },
      timeout: 60000,
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const saved = (await imported.json()).source;
    expect(saved.parseStatus).toBe("text_extracted");
    expect(saved.originalText.length).toBeGreaterThan(100);
    expect(
      saved.segments.some((segment: { location: string }) => /页/.test(segment.location)),
    ).toBe(true);
    const repeat = await request.post(endpoint, { data: { url: attachment.url }, timeout: 30000 });
    expect((await repeat.json()).reused).toBe(true);
    const extraction = await request.post(`/api/tasks/${taskId}/rules`);
    expect(extraction.status(), await extraction.text()).toBe(201);
    const rules = (await extraction.json()).ruleSet;
    expect(
      rules.sourceVersions.some((entry: { sourceId: string }) => entry.sourceId === saved.id),
    ).toBe(true);
    expect(
      rules.rules.some(
        (rule: { source: { sourceId: string; quotedText: string } }) =>
          rule.source.sourceId === saved.id && saved.originalText.includes(rule.source.quotedText),
      ),
    ).toBe(true);
    const after = (await (await request.get(`/api/tasks/${taskId}`)).json()).task;
    expect(
      after.supplementalSources.filter(
        (entry: { sourceUrl: string }) => entry.sourceUrl === attachment.url,
      ),
    ).toHaveLength(1);
  } finally {
    await peer.dispose();
  }
});
