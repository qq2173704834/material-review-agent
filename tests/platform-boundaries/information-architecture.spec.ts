import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Actor } from "../helpers/platform-boundaries";
import type { NoticeContent } from "../../src/lib/server/exam-store";
import type { ScheduleNode } from "../../src/lib/schedule";
import type { CampusNotice, CampusEvent } from "../../src/domain/campus";
import {
  test,
  expect,
  createActor,
  draft,
  publish,
  noticeContent,
  database,
} from "../helpers/platform-boundaries";

async function sourceDraft(
  admin: Actor,
  content: NoticeContent,
  url?: string,
): Promise<{ id: string; changed: boolean; url: string }> {
  return draft(
    admin,
    {
      ...content,
      text: content.timeline.map((point) => point.quote).join("。") + "。须提交学籍证明。",
    },
    url,
  );
}

test("统一日程：全日期、相同来源去重、私有完成和并发保护，归档保留学习记录", async ({
  actors,
  playwright,
}) => {
  const actor = await createActor(playwright, "org_schedule");
  const content = noticeContent({
    title: `统一日程合成-${randomUUID()}`,
    edition: `合成场次-${randomUUID()}`,
    timeline: [
      { label: "笔试", value: "2027-06-12T09:00:00+08:00", quote: "考试2027年6月12日9时" },
      { label: "报名截止", value: "2027-05-20", quote: "5月20日截止" },
    ],
  });
  const item = await sourceDraft(actors.admin, content);
  await publish(actors.admin, item.id);
  const created = await actor.api.post("/api/goals", {
    data: { goal: { category: "cet4", region: "全国", noticeId: item.id } },
  });
  expect(created.ok()).toBe(true);
  const goal = (await created.json()).goal;
  await actor.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } });
  let nodes: ScheduleNode[] = (await (await actor.api.get("/api/schedule")).json()).nodes;
  expect(nodes.filter((node) => node.id.startsWith(`exam:${item.id}`))).toHaveLength(2);
  const exam = nodes.find((node) => node.label === "笔试")!;
  expect(exam.value).toBe(content.timeline[0]!.value);
  const mark = {
    id: exam.id,
    expectedRevision: exam.revision,
    sourceValue: exam.sourceValue,
    command: { action: "done", done: true },
  };
  expect((await actor.api.post("/api/schedule", { data: mark })).ok()).toBe(true);
  expect((await actor.api.post("/api/schedule", { data: mark })).status()).toBe(400);
  expect((await actors.peer.api.post("/api/schedule", { data: mark })).status()).toBe(400);
  nodes = (await (await actor.api.get("/api/schedule")).json()).nodes;
  expect(nodes.find((node) => node.id === exam.id)?.done).toBe(true);
  const before = (await (await actor.api.get(`/api/preparation?goal=${goal.id}`)).json()).state;
  expect(
    (
      await actor.api.post("/api/preparation", {
        data: {
          goalId: goal.id,
          expectedRevision: before.revision,
          command: { action: "template" },
        },
      })
    ).ok(),
  ).toBe(true);
  await actor.api.post(`/api/exams/${item.id}`, { data: { action: "unfavorite" } });
  const { id, updatedAt, autoReview, taskId, noticeVersion, ...input } = goal;
  void updatedAt;
  void autoReview;
  void taskId;
  void noticeVersion;
  expect(
    (
      await actor.api.post("/api/goals", { data: { id, goal: { ...input, state: "archived" } } })
    ).ok(),
  ).toBe(true);
  expect((await (await actor.api.get("/api/schedule")).json()).nodes).toHaveLength(0);
  expect(
    (await (await actor.api.get(`/api/preparation?goal=${id}`)).json()).state.stages,
  ).toHaveLength(3);
  await actor.api.dispose();
});

test("公开日期更正复用节点、保留手填时间并停止旧倒计时", async ({ actors, playwright }) => {
  const actor = await createActor(playwright, "org_change");
  const content = noticeContent({
    title: `改期合成-${randomUUID()}`,
    edition: `合成-${randomUUID()}`,
    timeline: [{ label: "笔试", value: "2027-06-12", quote: "6月12日考试" }],
  });
  const item = await sourceDraft(actors.admin, content);
  await publish(actors.admin, item.id);
  await actor.api.post("/api/goals", {
    data: { goal: { category: "cet4", region: "全国", noticeId: item.id } },
  });
  const first: ScheduleNode = (await (await actor.api.get("/api/schedule")).json()).nodes[0];
  expect(
    (
      await actor.api.post("/api/schedule", {
        data: {
          id: first.id,
          sourceValue: first.sourceValue,
          expectedRevision: first.revision,
          command: { action: "date", value: "2027-06-13T10:00" },
        },
      })
    ).ok(),
  ).toBe(true);
  const changed = await sourceDraft(
    actors.admin,
    {
      ...content,
      timeline: [{ label: "笔试", value: "", quote: "考试延期，时间另行通知" }],
    },
    item.url,
  );
  expect(changed.id).toBe(item.id);
  await publish(actors.admin, item.id, 2);
  let node: ScheduleNode = (await (await actor.api.get("/api/schedule")).json()).nodes[0];
  expect(node.id).toBe(first.id);
  expect(node.value).toBe("");
  expect(node.changed).toBe(true);
  expect(node.manualValue).toBe("2027-06-13T10:00");
  expect(
    (
      await actor.api.post("/api/schedule", {
        data: {
          id: first.id,
          sourceValue: first.sourceValue,
          expectedRevision: 0,
          command: { action: "date", value: "2027-06-14" },
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await actor.api.post("/api/schedule", {
        data: {
          id: node.id,
          sourceValue: node.sourceValue,
          expectedRevision: node.revision,
          command: { action: "reset" },
        },
      })
    ).ok(),
  ).toBe(true);
  await sourceDraft(
    actors.admin,
    { ...content, timeline: [{ label: "笔试", value: "2027-07-12", quote: "改为7月12日" }] },
    item.url,
  );
  await publish(actors.admin, item.id, 3);
  const nodes: ScheduleNode[] = (await (await actor.api.get("/api/schedule")).json()).nodes;
  expect(nodes).toHaveLength(1);
  node = nodes[0]!;
  expect(node.id).toBe(first.id);
  expect(node.value).toBe("2027-07-12");
  await actor.api.dispose();
});

test("未知目标可补日期；关联公告后不重复，并保留原个人安排", async ({ actors, playwright }) => {
  const actor = await createActor(playwright, "org_unknown");
  const goal = (
    await (
      await actor.api.post("/api/goals", { data: { goal: { category: "cet4", region: "全国" } } })
    ).json()
  ).goal;
  const unknown: ScheduleNode = (await (await actor.api.get("/api/schedule")).json()).nodes[0];
  expect(unknown.value).toBe("");
  expect(
    (
      await actor.api.post("/api/schedule", {
        data: {
          id: unknown.id,
          expectedRevision: 0,
          sourceValue: "",
          command: { action: "date", value: "2027-08-01" },
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await (await actor.api.get("/api/schedule")).json()).nodes[0].value).toBe("2027-08-01");
  const item = await sourceDraft(
    actors.admin,
    noticeContent({
      edition: `已公布-${randomUUID()}`,
      timeline: [{ label: "笔试", value: "2027-08-02", quote: "8月2日考试" }],
    }),
  );
  await publish(actors.admin, item.id);
  expect(
    (
      await actor.api.post("/api/goals", {
        data: { id: goal.id, goal: { category: "cet4", region: "全国", noticeId: item.id } },
      })
    ).ok(),
  ).toBe(true);
  const nodes: ScheduleNode[] = (await (await actor.api.get("/api/schedule")).json()).nodes;
  expect(nodes).toHaveLength(1);
  expect(nodes[0]!.manualValue).toBe("2027-08-01");
  expect(nodes[0]!.changed).toBe(true);
  await actor.api.dispose();
});

test("五主入口、个人分区、跨标签页完成同步和首页限量，保留旧链接并保存截图", async ({
  actors,
  playwright,
  browser,
}) => {
  const actor = await createActor(playwright, "org_ui");
  const content = noticeContent({
    title: `跨页合成-${randomUUID()}`,
    edition: `跨页-${randomUUID()}`,
    timeline: [{ label: "笔试", value: "2027-12-01", quote: "12月1日考试" }],
  });
  const source = await sourceDraft(actors.admin, content);
  await publish(actors.admin, source.id);
  const goal = (
    await (
      await actor.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", noticeId: source.id } },
      })
    ).json()
  ).goal;
  const initial = (await (await actor.api.get("/api/campus")).json()).state;
  const chosen = await actor.api.post("/api/campus", {
    data: {
      action: "preferences",
      expectedRevision: initial.revision,
      preferences: { schoolId: "sspu", department: "", grade: "", interests: [] },
    },
  });
  const state = (await chosen.json()).state;
  const homework = {
    id: randomUUID(),
    title: "独立私人作业",
    kind: "作业",
    start: "",
    end: "2027-01-06",
    course: "高数",
  };
  const unknown = { id: randomUUID(), title: "待定课程报告", kind: "课程报告", start: "", end: "" };
  expect(
    (
      await actor.api.post("/api/campus", {
        data: { action: "save", expectedRevision: state.revision, events: [homework, unknown] },
      })
    ).ok(),
  ).toBe(true);
  const context = await browser.newContext({
    storageState: await actor.api.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/me");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link")).toHaveText([
    "首页",
    "考试中心",
    "校园通知",
    "学习资源",
    "我的备考",
  ]);
  await expect(page.getByRole("navigation", { name: "我的备考导航" }).getByRole("link")).toHaveText(
    ["考试目标", "我的日程", "学习记录"],
  );
  await expect(page.getByRole("heading", { name: homework.title, exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: `账号设置：${actor.username}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "退出登录", exact: true })).toBeVisible();
  await page.goto(`/me/preparation?goal=${goal.id}`);
  await expect(page.getByText(homework.title, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "考试日历", exact: true })).toHaveCount(0);
  await page.goto(`/me/preparation?goal=${goal.id}&view=calendar`);
  await expect(page).toHaveURL(new RegExp(`/me/schedule\\?goal=${goal.id}`));
  await page.goto("/me/schedule?pending=1");
  await expect(page.getByRole("heading", { name: unknown.title, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: homework.title, exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/me/schedule");
  const card = page.getByRole("article", { name: content.title, exact: true });
  await card.getByRole("button", { name: "完成", exact: true }).click();
  await expect(card).toHaveCount(0);
  await second.bringToFront();
  await expect(second.getByRole("article", { name: content.title, exact: true })).toHaveCount(0);
  await second.getByLabel("显示已完成", { exact: true }).check();
  const completed = second.getByRole("article", { name: content.title, exact: true });
  await expect(completed.getByText("已完成", { exact: true })).toBeVisible();
  await completed.getByRole("button", { name: "恢复待办", exact: true }).click();
  await expect(completed.getByRole("button", { name: "完成", exact: true })).toBeVisible();
  await second.close();
  await mkdir("outputs/eng-095", { recursive: true });
  for (const route of [
    "/",
    "/campus",
    "/me",
    "/me/schedule?pending=1",
    `/me/records?goal=${goal.id}`,
  ]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    if (route === "/") {
      expect(await page.locator(".exam-card").count()).toBeLessThanOrEqual(6);
      expect(
        await page.getByRole("region", { name: "本校重要通知" }).getByRole("link").count(),
      ).toBeLessThanOrEqual(4);
      expect(
        await page.getByRole("region", { name: "本人近期事项" }).locator("a.rounded-xl").count(),
      ).toBeLessThanOrEqual(3);
    }
    if (route === "/campus")
      await expect(page.getByRole("button", { name: "添加日程", exact: true })).toHaveCount(0);
    const name = route === "/" ? "home" : route.split("?")[0]!.replaceAll("/", "-").slice(1);
    await page.screenshot({ path: `outputs/eng-095/${name}-desktop.png`, fullPage: true });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 390)
        await page.screenshot({ path: `outputs/eng-095/${name}-mobile.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.goto(`/campus?proposal=${encodeURIComponent("高数作业明天交")}&edit=${homework.id}`);
  await expect(page).toHaveURL(/\/me\/schedule\?/);
  await expect(page.getByLabel("事项名称", { exact: true })).toHaveValue(homework.title);
  expect(errors).toEqual([]);
  const db = database();
  expect(
    (
      db.prepare("SELECT COUNT(*) count FROM campus_states WHERE user_id=?").get(actor.id) as {
        count: number;
      }
    ).count,
  ).toBe(1);
  db.close();
  await context.close();
  await actor.api.dispose();
});

test("校园通知选择确认、来源更正核对与材料结果待复检，共用原事项", async ({
  playwright,
  browser,
}) => {
  const actor = await createActor(playwright, "org_campus");
  const initial = (await (await actor.api.get("/api/campus")).json()).state;
  await actor.api.post("/api/campus", {
    data: {
      action: "preferences",
      expectedRevision: initial.revision,
      preferences: { schoolId: "sspu", department: "", grade: "", interests: [] },
    },
  });
  const source: CampusNotice = {
    id: randomUUID(),
    schoolId: "sspu",
    department: "合成部门",
    title: "合成奖学金申请通知",
    url: "https://www.sspu.edu.cn/synthetic/notice.html",
    publishedAt: "2026-11-15",
    text: "奖学金报名截止2027年1月6日。期末考试2027年1月10日09:00。须提交学籍证明材料。",
    category: "奖助评优",
    digest: "a".repeat(64),
    updatedAt: "2026-11-15T08:00:00Z",
  };
  const db = database();
  db.prepare("INSERT INTO campus_notices VALUES (?,?,?)").run(
    source.id,
    source.schoolId,
    JSON.stringify(source),
  );
  db.close();
  const context = await browser.newContext({ storageState: await actor.api.storageState() });
  const page = await context.newPage();
  await page.goto(`/campus?notice=${source.id}`);
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: source.title, exact: true }) });
  await card.getByRole("button", { name: "＋ 加入日程", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我收到的通知", exact: true })).toBeVisible();
  expect((await (await actor.api.get("/api/campus")).json()).state.events).toHaveLength(0);
  await expect(page.getByLabel("加入日程", { exact: true })).toHaveCount(2);
  await page.getByLabel("加入日程", { exact: true }).nth(1).uncheck();
  await page.getByRole("button", { name: "确认加入我的日程", exact: true }).click();
  await expect(page).toHaveURL(/\/me\/schedule/);
  let state = (await (await actor.api.get("/api/campus")).json()).state;
  expect(state.events).toHaveLength(1);
  const original: CampusEvent = state.events[0];
  expect(original.end).toBe("2027-01-06");
  expect(original.sourceNodeKey).toBeTruthy();
  const linked = (
    await (
      await actor.api.post("/api/campus/review", { data: { id: source.id, digest: source.digest } })
    ).json()
  ).taskId;
  expect(linked).toBeTruthy();
  expect((await actor.api.post(`/api/tasks/${linked}/rules?prepare=1`)).ok()).toBe(true);
  const checks = await actor.api.post(`/api/tasks/${linked}/checks?mode=mock`);
  expect(checks.ok()).toBe(true);
  await checks.text();
  const updated = {
    ...source,
    digest: "b".repeat(64),
    text: "奖学金报名截止2027年1月7日。须提交学籍证明材料及申请表。",
  };
  const changedDb = database();
  changedDb
    .prepare("UPDATE campus_notices SET payload=? WHERE id=?")
    .run(JSON.stringify(updated), source.id);
  changedDb.close();
  const executions = (await (await actor.api.get(`/api/tasks/${linked}/checks`)).json()).executions;
  expect(executions[0].validity).toBe("needs_recheck");
  expect(executions[0].invalidationReasons.join(" ")).toContain("校园通知已更新");
  const nodes: ScheduleNode[] = (await (await actor.api.get("/api/schedule")).json()).nodes;
  expect(nodes[0]!.value).toBe("");
  expect(nodes[0]!.changed).toBe(true);
  expect((await (await actor.api.get("/api/campus")).json()).state.events[0].end).toBe(
    original.end,
  );
  await page.goto(`/me/schedule?edit=${original.id}&pending=1`);
  await page.getByLabel("我已核对最新通知中的安排", { exact: true }).check();
  await page.getByLabel("截止", { exact: true }).fill("2027-01-07");
  await page.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(page.getByLabel("事项名称", { exact: true })).toHaveCount(0);
  state = (await (await actor.api.get("/api/campus")).json()).state;
  expect(state.events[0].id).toBe(original.id);
  expect(state.events[0].sourceDigest).toBe(updated.digest);
  expect((await (await actor.api.get("/api/schedule")).json()).nodes[0].value).toBe("2027-01-07");
  expect(
    (
      await actor.api.post("/api/campus", {
        data: {
          action: "save",
          expectedRevision: state.revision,
          events: [{ ...state.events[0], id: randomUUID(), title: "同一节点重新导入" }],
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await (await actor.api.get("/api/campus")).json()).state.events).toHaveLength(1);
  const dedupState = (await (await actor.api.get("/api/campus")).json()).state;
  // Two separate source nodes can have the same title/type; only the same key is a duplicate.
  expect(
    (
      await actor.api.post("/api/campus", {
        data: {
          action: "save",
          expectedRevision: dedupState.revision,
          events: [{ ...dedupState.events[0], id: randomUUID(), sourceNodeKey: "报名:another" }],
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await (await actor.api.get("/api/campus")).json()).state.events).toHaveLength(2);
  await page.goto(
    `/tasks/${linked}?returnTo=${encodeURIComponent(`/me/schedule?edit=${original.id}`)}`,
  );
  await expect(page.getByRole("link", { name: "← 返回我的日程", exact: true })).toBeVisible();
  await context.close();
  await actor.api.dispose();
});

test("未登录日程门禁及公告撤回后未知安排不沿用旧时间", async ({ actors, playwright }) => {
  const guest = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3132" });
  expect((await guest.get("/api/schedule")).status()).toBe(401);
  await guest.dispose();
  const actor = await createActor(playwright, "org_withdraw");
  const item = await sourceDraft(
    actors.admin,
    noticeContent({
      edition: `撤回-${randomUUID()}`,
      timeline: [{ label: "笔试", value: "2027-09-01", quote: "9月1日考试" }],
    }),
  );
  await publish(actors.admin, item.id);
  await actor.api.post("/api/goals", {
    data: { goal: { category: "cet4", region: "全国", noticeId: item.id } },
  });
  const before: ScheduleNode = (await (await actor.api.get("/api/schedule")).json()).nodes[0];
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: { action: "withdraw", id: item.id, version: 1 },
      })
    ).ok(),
  ).toBe(true);
  const after: ScheduleNode[] = (await (await actor.api.get("/api/schedule")).json()).nodes;
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(before.id);
  expect(after[0]!.value).toBe("");
  expect(after[0]!.changed).toBe(true);
  await actor.api.dispose();
});
