import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { StudentGoal } from "../../src/domain/student-goal";
import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  draft,
  publish,
  noticeContent,
  createActor,
} from "../helpers/platform-boundaries";

async function goal(api: APIRequestContext, overrides = {}): Promise<StudentGoal> {
  const response = await api.post("/api/goals", {
    data: { goal: { category: "cet4", region: "全国", ...overrides } },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).goal;
}
async function mutate(
  api: APIRequestContext,
  goalId: string,
  revision: number,
  command: unknown,
): Promise<APIResponse> {
  return api.post("/api/preparation", { data: { goalId, expectedRevision: revision, command } });
}
test("已知场次自动关联且六级目标识别合并公告；未知目标保持可见", async ({ actors, browser }) => {
  const edition = `合成场次-${randomUUID()}`;
  const item = await draft(
    actors.admin,
    noticeContent({ edition, title: "合成大学英语四、六级报名公告" }),
  );
  await publish(actors.admin, item.id);
  const known = await goal(actors.student.api, { edition, category: "cet6" });
  expect(known.noticeId).toBe(item.id);
  const unknown = await goal(actors.student.api, { category: "ncre" });
  const context = await browser.newContext({
    storageState: await actors.student.api.storageState(),
  });
  const page = await context.newPage();
  await page.goto(`/me/preparation?goal=${known.id}&view=calendar`);
  await page.getByLabel("查看月份").fill("2027-03");
  await page.getByRole("button", { name: "2027-03-20，1项安排" }).click();
  await expect(page.getByText("2027-03-20的安排")).toBeVisible();
  await page.goto(`/me/preparation?goal=${unknown.id}&view=calendar`);
  await expect(page.getByText("时间待公布", { exact: false }).first()).toBeVisible();
  await page.goto("/me");
  await expect(page.getByText("计算机等级考试", { exact: false }).first()).toBeVisible();
  await context.close();
});
test("目标权限、并发冲突、真实完成记录与持久化", async ({ actors }) => {
  const item = await goal(actors.student.api);
  expect((await actors.peer.api.get(`/api/preparation?goal=${item.id}`)).status()).toBe(404);
  expect((await mutate(actors.peer.api, item.id, 0, { action: "template" })).ok()).toBe(false);
  let response = await mutate(actors.student.api, item.id, 0, { action: "template" });
  expect(response.ok()).toBe(true);
  let state = (await response.json()).state;
  const task = {
    id: randomUUID(),
    stageId: state.stages[0].id,
    title: "合成学习任务",
    date: "2026-11-15",
    minutes: 45,
    actualMinutes: null,
    doneOn: "",
    resourceId: "",
    locked: false,
  };
  response = await mutate(actors.student.api, item.id, state.revision, { action: "task", task });
  expect(response.ok()).toBe(true);
  state = (await response.json()).state;
  expect(
    (
      await mutate(actors.student.api, item.id, state.revision - 1, {
        action: "removeTask",
        id: task.id,
      })
    ).ok(),
  ).toBe(false);
  response = await mutate(actors.student.api, item.id, state.revision, {
    action: "task",
    task: { ...task, doneOn: "2026-11-15", actualMinutes: 20 },
  });
  expect(response.ok()).toBe(true);
  state = (await response.json()).state;
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0].actualMinutes).toBe(20);
  expect(
    (await (await actors.student.api.get(`/api/preparation?goal=${item.id}`)).json()).state,
  ).toEqual(state);
  expect(
    (
      await mutate(actors.student.api, item.id, state.revision, {
        action: "task",
        task: { ...task, date: "2026-02-30" },
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await mutate(actors.student.api, item.id, state.revision, {
        action: "removeStage",
        id: task.stageId,
      })
    ).ok(),
  ).toBe(false);
});
test("AI只生成草稿；采纳幂等、锁定保留、撤销拒绝覆盖后续修改", async ({ actors }) => {
  const item = await goal(actors.student.api);
  const request = {
    goalId: item.id,
    expectedRevision: 0,
    requestId: randomUUID(),
    minutes: 30,
    dates: ["2026-11-16", "2026-11-17"],
    preference: "合成测试",
  };
  let response = await actors.student.api.post("/api/preparation?generate=1", { data: request });
  expect(response.ok(), await response.text()).toBe(true);
  let state = (await response.json()).state;
  expect(state.tasks).toHaveLength(0);
  expect(state.drafts[0].mode).toBe("mock");
  response = await actors.student.api.post("/api/preparation?generate=1", { data: request });
  expect(response.ok()).toBe(true);
  expect((await response.json()).state.drafts).toHaveLength(1);
  const command = { action: "adopt", draftId: request.requestId, replace: false, selected: [0, 1] };
  response = await mutate(actors.student.api, item.id, state.revision, command);
  expect(response.ok()).toBe(true);
  state = (await response.json()).state;
  expect(state.tasks).toHaveLength(2);
  response = await mutate(actors.student.api, item.id, 0, command);
  expect(response.ok()).toBe(true);
  expect((await response.json()).state.tasks).toHaveLength(2);
  const history = state.history[0];
  response = await mutate(actors.student.api, item.id, state.revision, {
    action: "task",
    task: { ...state.tasks[0], doneOn: "2026-11-16", actualMinutes: 18, locked: true },
  });
  expect(response.ok()).toBe(true);
  state = (await response.json()).state;
  expect(
    (
      await mutate(actors.student.api, item.id, state.revision, { action: "undo", id: history.id })
    ).ok(),
  ).toBe(false);
  const second = { ...request, expectedRevision: state.revision, requestId: randomUUID() };
  response = await actors.student.api.post("/api/preparation?generate=1", { data: second });
  expect(response.ok()).toBe(true);
  state = (await response.json()).state;
  response = await mutate(actors.student.api, item.id, state.revision, {
    ...command,
    draftId: second.requestId,
    replace: true,
  });
  expect(response.ok()).toBe(true);
  state = (await response.json()).state;
  expect(state.tasks.find((t: { locked: boolean }) => t.locked)?.actualMinutes).toBe(18);
  response = await mutate(actors.student.api, item.id, state.revision, {
    action: "undo",
    id: state.history.at(-1).id,
  });
  expect(response.ok()).toBe(true);
});
test("自测拒绝非法成绩与重复维度，记录删除不串目标", async ({ actors }) => {
  const item = await goal(actors.student.api);
  const assessment = {
    id: randomUUID(),
    date: "2026-11-15",
    name: "合成自测",
    source: "自报",
    system: "合成体系",
    scores: [{ dimension: "阅读", score: 8, maximum: 10 }],
  };
  expect(
    (
      await mutate(actors.student.api, item.id, 0, {
        action: "assessment",
        assessment: { ...assessment, scores: [{ dimension: "阅读", score: 11, maximum: 10 }] },
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await mutate(actors.student.api, item.id, 0, {
        action: "assessment",
        assessment: { ...assessment, scores: [...assessment.scores, ...assessment.scores] },
      })
    ).ok(),
  ).toBe(false);
  let response = await mutate(actors.student.api, item.id, 0, { action: "assessment", assessment });
  expect(response.ok()).toBe(true);
  const state = (await response.json()).state;
  response = await mutate(actors.student.api, item.id, state.revision, {
    action: "removeAssessment",
    id: assessment.id,
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).state.assessments).toHaveLength(0);
});
test("手机备考旅程、筛选标签与普通用户无采集诊断", async ({ playwright, browser }) => {
  const actor = await createActor(playwright, "prep_mobile");
  const item = await goal(actor.api);
  let response = await mutate(actor.api, item.id, 0, { action: "template" });
  let seed = (await response.json()).state;
  response = await mutate(actor.api, item.id, seed.revision, {
    action: "task",
    task: {
      id: randomUUID(),
      stageId: seed.stages[0].id,
      title: "合成阅读练习",
      date: "2026-11-15",
      minutes: 30,
      actualMinutes: 25,
      doneOn: "2026-11-15",
      resourceId: "",
      locked: false,
    },
  });
  seed = (await response.json()).state;
  for (const [date, score] of [
    ["2026-11-10", 6],
    ["2026-11-15", 8],
  ] as const) {
    response = await mutate(actor.api, item.id, seed.revision, {
      action: "assessment",
      assessment: {
        id: randomUUID(),
        date,
        name: `合成自测${date}`,
        source: "自报",
        system: "合成评分体系",
        scores: [
          { dimension: "阅读", score, maximum: 10 },
          { dimension: "听力", score: 5, maximum: 10 },
          { dimension: "写作", score: 7, maximum: 10 },
        ],
      },
    });
    seed = (await response.json()).state;
  }
  response = await actor.api.post("/api/preparation?generate=1", {
    data: {
      goalId: item.id,
      expectedRevision: seed.revision,
      requestId: randomUUID(),
      minutes: 30,
      dates: ["2026-11-16"],
      preference: "合成学习",
    },
  });
  expect(response.ok()).toBe(true);
  const context = await browser.newContext({
    storageState: await actor.api.storageState(),
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`/me/preparation?goal=${item.id}`);
  await expect(page.getByRole("button", { name: "备考概览", exact: true })).toBeVisible();
  for (const view of ["calendar", "roadmap", "plan", "materials", "records"]) {
    await page.goto(`/me/preparation?goal=${item.id}&view=${view}`);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `outputs/eng-080/mobile-${view}.png`, fullPage: true });
  }
  for (const width of [320, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ["overview", "calendar", "roadmap", "plan", "materials", "records"]) {
      await page.goto(`/me/preparation?goal=${item.id}&view=${view}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (view === "records")
        await page.screenshot({ path: `outputs/eng-080/records-${width}.png`, fullPage: true });
      if (width === 1280)
        for (const zoom of [1.25, 1.5]) {
          await page.evaluate((value) => {
            document.documentElement.style.zoom = String(value);
          }, zoom);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
    }
  }
  await page.goto("/exams?category=cet4&q=合成");
  await expect(page.getByRole("link", { name: "移除考试类别筛选" })).toBeVisible();
  await expect(page.getByText("已登记，尚无采集成功记录", { exact: false })).toHaveCount(0);
  await page.getByRole("link", { name: "移除关键词筛选" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
  expect(new URL(page.url()).searchParams.get("category")).toBe("cet4");
  await page.goto("/learn?saved=1");
  await expect(page.getByRole("link", { name: "移除只看收藏筛选" })).toBeVisible();
  await context.close();
  await actor.api.dispose();
});
test("阶段区间与计划草稿有服务端约束，超时长和伪资料不落库", async ({ playwright }) => {
  const actor = await createActor(playwright, "prep_limits");
  const item = await goal(actor.api);
  let response = await mutate(actor.api, item.id, 0, {
    action: "template",
    start: "2026-11-16",
    end: "2026-12-06",
  });
  expect(response.ok()).toBe(true);
  let state = (await response.json()).state;
  expect(state.stages[0].start).toBe("2026-11-16");
  expect(state.stages[2].end).toBe("2026-12-06");
  const task = {
    id: randomUUID(),
    stageId: state.stages[0].id,
    title: "伪资料测试",
    date: "",
    minutes: 10,
    actualMinutes: null,
    doneOn: "",
    resourceId: randomUUID(),
    locked: false,
  };
  expect((await mutate(actor.api, item.id, state.revision, { action: "task", task })).ok()).toBe(
    false,
  );
  const request = {
    goalId: item.id,
    expectedRevision: state.revision,
    requestId: randomUUID(),
    minutes: 30,
    dates: ["2026-11-16"],
    preference: "",
  };
  response = await actor.api.post("/api/preparation?generate=1", { data: request });
  expect(response.ok()).toBe(true);
  state = (await response.json()).state;
  const draft = state.drafts.at(-1);
  expect(
    (
      await mutate(actor.api, item.id, state.revision, {
        action: "draft",
        draft: { id: draft.id, items: [{ ...draft.items[0], minutes: 31 }] },
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await mutate(actor.api, item.id, state.revision, {
        action: "draft",
        draft: { id: draft.id, items: [{ ...draft.items[0], date: "2026-11-17" }] },
      })
    ).ok(),
  ).toBe(false);
  expect(
    (
      await mutate(actor.api, item.id, state.revision, {
        action: "adopt",
        draftId: draft.id,
        selected: [34],
        replace: false,
      })
    ).ok(),
  ).toBe(false);
  expect(
    (await (await actor.api.get(`/api/preparation?goal=${item.id}`)).json()).state.tasks,
  ).toHaveLength(0);
  await actor.api.post("/api/learning", {
    data: { action: "preferences", personalized: true, retainChat: false, externalEnabled: false },
  });
  expect(
    (
      await actor.api.post("/api/preparation?generate=1", {
        data: { ...request, requestId: randomUUID(), expectedRevision: state.revision },
      })
    ).ok(),
  ).toBe(false);
  await actor.api.dispose();
});
test("资料返回保留查询和浏览位置，偏好折叠及成功提示自动结束", async ({ playwright, browser }) => {
  const actor = await createActor(playwright, "prep_return");
  const context = await browser.newContext({
    storageState: await actor.api.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/learn?hidden=1");
  const preferences = page.getByText("学习偏好", { exact: true }).first();
  await expect(page.getByRole("form", { name: "学习与隐私偏好" })).toBeHidden();
  await preferences.click();
  await expect(page.getByRole("form", { name: "学习与隐私偏好" })).toBeVisible();
  await preferences.click();
  const link = page.getByRole("link", { name: "查看资料 →", exact: true }).nth(3);
  await link.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  expect(position).toBeGreaterThan(200);
  await link.click();
  await page.getByRole("link", { name: "← 返回学习资源", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\?hidden=1&page=1/);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => scrollY)) - position))
    .toBeLessThan(100);
  await page.goto("/me");
  await page.getByText("添加考试目标", { exact: true }).click();
  await page.getByRole("button", { name: "保存目标", exact: true }).click();
  await expect(page.getByText("考试目标已保存。", { exact: true })).toBeVisible();
  await expect(page.getByText("考试目标已保存。", { exact: true })).toBeHidden({ timeout: 5000 });
  await context.close();
  await actor.api.dispose();
});
