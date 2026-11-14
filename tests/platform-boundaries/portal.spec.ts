import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  draft,
  publish,
  noticeContent,
  database,
} from "../helpers/platform-boundaries";
test("目标私有隔离、编辑归档与严格输入", async ({ actors }) => {
  const response = await actors.student.api.post("/api/goals", {
    data: {
      goal: { category: "cet4", region: "全国", edition: "2027年合成考期", progress: "基础复习" },
    },
  });
  expect(response.status()).toBe(200);
  const { goal } = await response.json();
  expect(
    (await (await actors.student.api.get("/api/goals")).json()).goals.some(
      (item: { id: string }) => item.id === goal.id,
    ),
  ).toBe(true);
  expect(
    (await (await actors.peer.api.get("/api/goals")).json()).goals.some(
      (item: { id: string }) => item.id === goal.id,
    ),
  ).toBe(false);
  expect(
    (
      await actors.peer.api.post("/api/goals", {
        data: { id: goal.id, goal: { category: "cet4", region: "全国" } },
      })
    ).status(),
  ).toBe(400);
  expect((await actors.peer.api.get(`/me/goals/${goal.id}`)).status()).toBe(404);
  expect(
    (
      await actors.student.api.post("/api/goals", {
        data: { id: goal.id, goal: { category: "cet4", region: "全国", state: "archived" } },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await actors.student.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", userId: actors.peer.id } },
      })
    ).status(),
  ).toBe(400);
});
test("助手未知证据、请求幂等、会话隔离及删除", async ({ actors }) => {
  const input = { requestId: randomUUID(), question: "某个没有录入的合成考试具体报名条件是什么？" };
  const first = await actors.student.api.post("/api/assistant", { data: input });
  expect(first.status(), await first.text()).toBe(200);
  const answer = await first.json();
  expect(answer.kind).toBe("需补充信息");
  expect(answer.citations).toEqual([]);
  const repeated = await actors.student.api.post("/api/assistant", { data: input });
  expect(await repeated.json()).toEqual(answer);
  expect(
    (
      await actors.student.api.post("/api/assistant", { data: { ...input, question: "其他问题" } })
    ).status(),
  ).toBe(400);
  expect(
    (await actors.peer.api.get(`/api/assistant?conversation=${answer.conversationId}`)).status(),
  ).toBe(404);
  expect(
    (
      await actors.peer.api.post("/api/assistant", {
        data: {
          requestId: randomUUID(),
          question: "学习建议",
          conversationId: answer.conversationId,
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await actors.student.api.delete("/api/assistant", { data: { id: answer.conversationId } })
    ).status(),
  ).toBe(200);
  expect(
    (await actors.student.api.get(`/api/assistant?conversation=${answer.conversationId}`)).status(),
  ).toBe(404);
});
test("学习资源种子诚实标注、收藏隔离与偏好", async ({ actors }) => {
  const response = await actors.student.api.get("/api/learning");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toBeTruthy();
  expect(
    (
      await actors.student.api.post("/api/learning", {
        data: { action: "preferences", personalized: false, retainChat: false },
      })
    ).status(),
  ).toBe(200);
  const assistant = await (await actors.student.api.get("/api/assistant")).json();
  expect(assistant.preferences.retainChat).toBe(false);
  const reply = await actors.student.api.post("/api/assistant", {
    data: { requestId: randomUUID(), question: "无来源合成考试怎么报名" },
  });
  expect(reply.status()).toBe(200);
  expect((await reply.json()).conversationId).toBeNull();
  expect(
    (
      await actors.student.api.post("/api/learning", {
        data: { action: "preferences", personalized: true, retainChat: true },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await actors.student.api.post("/api/admin/learning", {
        data: { action: "withdraw", id: randomUUID() },
      })
    ).status(),
  ).toBe(403);
});

test("目标关联任务、授权开关、自动快照去重及明确采用新版", async ({ actors }) => {
  const content = noticeContent(),
    item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const api = actors.student.api;
  const goal = (
    await (
      await api.post("/api/goals", {
        data: {
          goal: { category: "cet4", region: "全国", edition: content.edition, noticeId: item.id },
        },
      })
    ).json()
  ).goal;
  const endpoint = "/api/goals/review";
  expect(
    (await actors.peer.api.post(endpoint, { data: { goalId: goal.id, auto: true } })).status(),
  ).toBe(400);
  const bind = await api.post(endpoint, {
    data: { goalId: goal.id, auto: true, stage: "招考报名" },
  });
  expect(bind.status(), await bind.text()).toBe(200);
  const { taskId } = await bind.json();
  expect((await api.post(`/api/tasks/${taskId}/rules`)).status()).toBe(201);
  expect(
    (
      await api.post(`/api/tasks/${taskId}/materials`, {
        multipart: {
          files: {
            name: "学籍证明.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("学籍证明：合成学生在读。"),
          },
        },
      })
    ).status(),
  ).toBe(201);
  const run = await api.post(endpoint, { data: { goalId: goal.id, auto: true, checkNow: true } });
  expect(run.status(), await run.text()).toBe(200);
  const db = database();
  try {
    const jobs = (): Array<{ status: string }> =>
      db.prepare("SELECT * FROM portal_jobs WHERE goal_id=?").all(goal.id) as Array<{
        status: string;
      }>;
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]?.status).toBe("completed");
    expect(
      (
        await api.post(endpoint, { data: { goalId: goal.id, auto: true, checkNow: true } })
      ).status(),
    ).toBe(200);
    expect(jobs()).toHaveLength(1);
    await draft(
      actors.admin,
      { ...content, text: content.text + " 新版须补充电子照片。" },
      item.url,
    );
    await publish(actors.admin, item.id, 2);
    expect(
      (
        await api.post(endpoint, { data: { goalId: goal.id, auto: true, checkNow: true } })
      ).status(),
    ).toBe(200);
    expect(jobs()).toHaveLength(1);
    expect(
      (await api.post(endpoint, { data: { goalId: goal.id, auto: true, adopt: true } })).status(),
    ).toBe(200);
    const updated = (await (await api.get("/api/goals")).json()).goals.find(
      (item: { id: string }) => item.id === goal.id,
    );
    expect(updated.noticeVersion).toBe(2);
    expect(
      (await api.post(endpoint, { data: { goalId: goal.id, auto: false, pause: true } })).status(),
    ).toBe(200);
    expect(
      (
        await api.post(endpoint, { data: { goalId: goal.id, auto: true, checkNow: true } })
      ).status(),
    ).toBe(400);
  } finally {
    db.close();
  }
});
test("内容反馈仅用户主动提交、管理员处理及账号隔离", async ({ actors }) => {
  const response = await actors.student.api.post("/api/feedback", {
    data: {
      kind: "回答问题",
      note: "合成反馈：请核对考期",
      answer: "用户主动提交的合成回答",
      citations: [],
    },
  });
  expect(response.status()).toBe(200);
  const items = (await (await actors.student.api.get("/api/feedback")).json()).items;
  expect(items).toHaveLength(1);
  expect((await (await actors.peer.api.get("/api/feedback")).json()).items).toHaveLength(0);
  expect(
    (
      await actors.admin.api.post("/api/admin/learning", {
        data: {
          action: "feedback",
          id: items[0].id,
          status: "已处理",
          response: "已核对来源范围，测试处理完成。",
        },
      })
    ).status(),
  ).toBe(200);
  expect((await (await actors.student.api.get("/api/feedback")).json()).items[0].status).toBe(
    "已处理",
  );
});
test("桌面手机主流程与助手键盘关闭返回焦点", async ({ actors, page }) => {
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "考试信息与学习，一站跟进" })).toBeVisible();
    const button = page.getByRole("button", { name: "打开考试学习AI助手" });
    await button.click();
    const dialog = page.getByRole("dialog", { name: "考试学习AI助手" });
    await expect(dialog).toBeVisible();
    await page.getByRole("textbox", { name: "你的问题" }).fill("合成测试问题");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: /学习/ }).first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("学习资料修订保留发布快照，撤回后不进入推荐，草稿与错误版本受保护", async ({ actors }) => {
  const admin = actors.admin.api;
  const entries = (await (await admin.get("/api/admin/learning")).json()).entries;
  const entry = entries.find(
    (item: { content: { kind: string } }) => item.content.kind === "resource",
  );
  const changed = await admin.post("/api/admin/learning", {
    data: {
      action: "draft",
      id: entry.id,
      version: entry.version,
      content: { ...entry.content, title: "合成修订草稿，不应向学生泄露" },
    },
  });
  expect(changed.status()).toBe(200);
  const detail = await actors.student.api.get(`/learn/${entry.id}`);
  expect(await detail.text()).toContain(entry.content.title);
  expect(await detail.text()).not.toContain("合成修订草稿");
  expect(
    (
      await admin.post("/api/admin/learning", {
        data: { action: "draft", id: entry.id, version: entry.version, content: entry.content },
      })
    ).status(),
  ).toBe(400);
  const version = (await changed.json()).entry.version;
  expect(
    (
      await admin.post("/api/admin/learning", {
        data: { action: "withdraw", id: entry.id, version },
      })
    ).status(),
  ).toBe(200);
  const retired = await actors.student.api.get(`/learn/${entry.id}`);
  expect(retired.status()).toBe(200);
  expect(await retired.text()).toContain("该资料已撤回");
  expect(await retired.text()).not.toContain("合成修订草稿");
});
test("助手引用已审核公告原文，目标考试冲突不调用模型", async ({ actors }) => {
  const rateDb = database();
  rateDb.prepare("DELETE FROM rate_limits WHERE key=?").run(`writes:${actors.admin.id}`);
  rateDb.close();
  const content = noticeContent({
    edition: "2031年独立引用测试考期",
    year: 2031,
    text: "合成独立引用：2031年申请材料须包含在读学籍证明。",
    timeline: [],
    publishedAt: "2031-01-01",
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const goal = (
    await (
      await actors.student.api.post("/api/goals", {
        data: {
          goal: { category: "cet4", region: "全国", edition: content.edition, noticeId: item.id },
        },
      })
    ).json()
  ).goal;
  const response = await actors.student.api.post("/api/assistant", {
    data: {
      requestId: randomUUID(),
      question: "本次需提交什么申请材料",
      goalId: goal.id,
      useContext: true,
    },
  });
  expect(response.status()).toBe(200);
  const answer = await response.json();
  expect(answer.mode).toBe("mock");
  expect(
    answer.citations.some(
      (citation: { id: string; version: number; quote: string }) =>
        citation.id === item.id && citation.version === 1 && content.text.includes(citation.quote),
    ),
  ).toBe(true);
  expect(
    (
      await actors.student.api.post("/api/assistant", {
        data: {
          requestId: randomUUID(),
          question: "计算机二级报名条件",
          goalId: goal.id,
          useContext: true,
        },
      })
    ).status(),
  ).toBe(400);
});

test("清除目标停止计划且保留历史材料任务和结果", async ({ actors }) => {
  const content = noticeContent(),
    item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const api = actors.student.api;
  const goal = (
    await (
      await api.post("/api/goals", {
        data: {
          goal: { category: "cet4", region: "全国", edition: content.edition, noticeId: item.id },
        },
      })
    ).json()
  ).goal;
  const { taskId } = await (
    await api.post("/api/goals/review", { data: { goalId: goal.id, auto: false } })
  ).json();
  expect((await actors.peer.api.delete("/api/goals", { data: { id: goal.id } })).status()).toBe(
    200,
  );
  expect((await api.get(`/api/tasks/${taskId}`)).status()).toBe(200);
  expect((await api.delete("/api/goals", { data: { id: goal.id } })).status()).toBe(200);
  expect((await api.get(`/me/goals/${goal.id}`)).status()).toBe(404);
  expect((await api.get(`/api/tasks/${taskId}`)).status()).toBe(200);
});
