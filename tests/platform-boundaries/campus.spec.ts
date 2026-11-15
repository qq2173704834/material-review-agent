import type { AssistantAnswer } from "../../src/domain/assistant";
import type { CampusEvent } from "../../src/domain/campus";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { test, expect, createActor, database } from "../helpers/platform-boundaries";

function event(title = "合成高数期末"): CampusEvent {
  return {
    id: randomUUID(),
    title,
    kind: "考试",
    course: "高等数学",
    semester: "2026秋",
    start: "2027-01-06T09:00",
    end: "2027-01-06T11:00",
    location: "合成教室",
    note: "",
    sourceUrl: "",
    sourceId: "",
    sourceDigest: "",
    resourceIds: [],
    done: false,
    reminderHours: 24,
  };
}
test("校园选校、事项持久化、重复导入与跨账号隔离", async ({ playwright }) => {
  const a = await createActor(playwright, "campusa"),
    b = await createActor(playwright, "campusb");
  try {
    const initial = (await (await a.api.get("/api/campus")).json()).state;
    const selected = await a.api.post("/api/campus", {
      data: {
        action: "preferences",
        expectedRevision: initial.revision,
        preferences: { schoolId: "sspu", department: "计算机", grade: "大二", interests: [] },
      },
    });
    expect(selected.ok()).toBe(true);
    const body = await selected.json();
    expect(body.notices.length).toBeGreaterThan(0);
    const item = event();
    const saved = await a.api.post("/api/campus", {
      data: { action: "save", expectedRevision: body.state.revision, events: [item] },
    });
    expect(saved.ok()).toBe(true);
    const state = (await saved.json()).state;
    const repeated = await a.api.post("/api/campus", {
      data: {
        action: "save",
        expectedRevision: state.revision,
        events: [{ ...item, id: randomUUID() }],
      },
    });
    expect((await repeated.json()).state.events).toHaveLength(1);
    expect((await (await b.api.get("/api/campus")).json()).state.events).toEqual([]);
    const current = (await (await a.api.get("/api/campus")).json()).state;
    expect(
      (
        await a.api.post("/api/campus", {
          data: { action: "save", expectedRevision: 0, events: [item] },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.api.post("/api/campus", {
          data: {
            action: "save",
            expectedRevision: current.revision,
            events: [{ ...item, end: "2026-02-30" }],
          },
        })
      ).status(),
    ).toBe(400);
    const changed = await a.api.post("/api/campus", {
      data: {
        action: "save",
        expectedRevision: current.revision,
        events: [{ ...item, start: "", end: "", done: true }],
      },
    });
    expect((await changed.json()).state.events[0].start).toBe("");
  } finally {
    await a.api.dispose();
    await b.api.dispose();
  }
});
test("通知预览无写入、相对日期确认、学校已读与用户隔离", async ({ actors }) => {
  const before = (await (await actors.student.api.get("/api/campus")).json()).state;
  const response = await actors.student.api.post("/api/campus/import", {
    data: { text: "数据结构作业下周五提交" },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).drafts[0].end).toBe("");
  expect((await (await actors.student.api.get("/api/campus")).json()).state.revision).toBe(
    before.revision,
  );
  const withDate = await actors.student.api.post("/api/campus/import", {
    data: { text: "数据结构作业下周五提交", referenceDate: "2026-12-31" },
  });
  expect((await withDate.json()).drafts[0].end).toBe("2027-01-08");
  const selected = await actors.student.api.post("/api/campus", {
    data: {
      action: "preferences",
      expectedRevision: before.revision,
      preferences: { schoolId: "sspu", department: "", grade: "", interests: [] },
    },
  });
  const body = await selected.json(),
    notice = body.notices[0];
  const read = await actors.student.api.post("/api/campus", {
    data: {
      action: "read",
      expectedRevision: body.state.revision,
      id: notice.id,
      digest: notice.digest,
    },
  });
  expect((await read.json()).state.reads[notice.id]).toBe(notice.digest);
  expect(
    (await (await actors.peer.api.get("/api/campus")).json()).state.reads[notice.id],
  ).toBeUndefined();
  expect(
    (
      await actors.student.api.post("/api/campus/import", {
        data: { url: "http://127.0.0.1/private" },
      })
    ).status(),
  ).toBe(400);
});
test("校园页面添加日程并保存桌面手机截图", async ({ playwright, page }) => {
  const actor = await createActor(playwright, "campusui");
  expect(
    (
      await actor.api.post("/api/goals", { data: { goal: { category: "ncre", region: "全国" } } })
    ).ok(),
  ).toBe(true);
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/campus");
  await page.getByLabel("学校", { exact: true }).selectOption("sspu");
  await page.getByRole("button", { name: "保存学校", exact: true }).click();
  await expect(page.getByRole("heading", { name: "上海第二工业大学", exact: true })).toBeVisible();
  await mkdir("outputs/campus", { recursive: true });
  await page.screenshot({ path: "outputs/campus/notices-desktop.png", fullPage: false });
  await page.goto("/me/schedule");
  await page.getByRole("button", { name: "添加日程", exact: true }).click();
  await page.getByLabel("事项名称", { exact: true }).fill("合成课程报告");
  await page.getByRole("button", { name: "保存日程", exact: true }).click();
  await page.goto("/me/schedule?pending=1");
  await expect(page.getByRole("heading", { name: "合成课程报告", exact: true })).toBeVisible();
  await mkdir("outputs/campus", { recursive: true });
  await page.screenshot({ path: "outputs/campus/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "outputs/campus/mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(
    page.getByRole("heading", { name: "全国计算机等级考试 · 待确认考期", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "作业与报告", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "全国计算机等级考试 · 待确认考期", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "合成课程报告", exact: true })).toBeVisible();
  await actor.api.dispose();
});

test("校园材料任务幂等、通知撤回门禁与旧日程停止倒计时", async ({ actors, page }) => {
  const initial = (await (await actors.student.api.get("/api/campus")).json()).state;
  const selected = await actors.student.api.post("/api/campus", {
    data: {
      action: "preferences",
      expectedRevision: initial.revision,
      preferences: { schoolId: "sspu", department: "", grade: "", interests: [] },
    },
  });
  const body = await selected.json();
  const notice = body.notices.find((item: { text: string }) =>
    /(?:提交|上传|报送|提供)[^。\n]{0,60}(?:申请表|证明|报告|附件|材料)/u.test(item.text),
  );
  expect(notice).toBeTruthy();
  const first = await actors.student.api.post("/api/campus/review", {
    data: { id: notice.id, digest: notice.digest },
  });
  expect(first.status(), await first.text()).toBe(200);
  const linked = await first.json();
  expect(
    (
      await (
        await actors.student.api.post("/api/campus/review", {
          data: { id: notice.id, digest: notice.digest },
        })
      ).json()
    ).taskId,
  ).toBe(linked.taskId);
  expect((await actors.peer.api.get(`/api/tasks/${linked.taskId}`)).status()).toBe(404);
  expect(
    (
      await actors.student.api.post("/api/admin/campus", {
        data: { action: "moderate", id: notice.id, withdrawn: true },
      })
    ).status(),
  ).toBe(403);
  const linkedEvent = {
    ...event("来源更新回归事项"),
    sourceId: notice.id,
    sourceDigest: notice.digest,
  };
  const saved = await actors.student.api.post("/api/campus", {
    data: { action: "save", expectedRevision: body.state.revision, events: [linkedEvent] },
  });
  expect(saved.ok()).toBe(true);
  const currentRevision = (await saved.json()).state.revision;
  try {
    expect(
      (
        await actors.admin.api.post("/api/admin/campus", {
          data: { action: "moderate", id: notice.id, withdrawn: true },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await actors.student.api.post("/api/campus/review", {
          data: { id: notice.id, digest: notice.digest },
        })
      ).status(),
    ).toBe(400);
    const stale = await actors.student.api.post("/api/campus", {
      data: {
        action: "save",
        expectedRevision: currentRevision,
        events: [{ ...event(), sourceId: notice.id, sourceDigest: notice.digest }],
      },
    });
    expect(stale.status()).toBe(400);
    await page.context().addCookies((await actors.student.api.storageState()).cookies);
    await page.goto("/campus");
    await page.goto("/me/schedule?pending=1");
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: linkedEvent.title, exact: true }) });
    await expect(card.getByText("时间待定", { exact: true }).first()).toBeVisible();
    expect(
      (await (await actors.student.api.get("/api/campus")).json()).state.events.find(
        (item: { id: string }) => item.id === linkedEvent.id,
      ).start,
    ).toBe(linkedEvent.start);
    const db = database();
    expect(
      JSON.parse(
        (
          db.prepare("SELECT payload FROM campus_notices WHERE id=?").get(notice.id) as {
            payload: string;
          }
        ).payload,
      ).withdrawn,
    ).toBe(true);
    db.close();
  } finally {
    await actors.admin.api.post("/api/admin/campus", {
      data: { action: "moderate", id: notice.id, withdrawn: false },
    });
  }
});

test("校园助手只用本人授权上下文、建议不直接改数据，TXT导入不自动保存", async ({ playwright }) => {
  const actor = await createActor(playwright, "campusassist");
  try {
    const initial = (await (await actor.api.get("/api/campus")).json()).state;
    const title = `专属作业${randomUUID().slice(0, 8)}`;
    const saved = await actor.api.post("/api/campus", {
      data: {
        action: "save",
        expectedRevision: initial.revision,
        events: [{ ...event(title), kind: "作业" }],
      },
    });
    const revision = (await saved.json()).state.revision;
    const ask = async (useContext: boolean): Promise<AssistantAnswer> => {
      const response = await actor.api.post("/api/assistant", {
        data: { requestId: randomUUID(), question: "校园作业有哪些", useContext },
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    expect((await ask(false)).answer).not.toContain(title);
    expect((await ask(true)).answer).toContain(title);
    const suggestion = await actor.api.post("/api/assistant", {
      data: {
        requestId: randomUUID(),
        question: `调整校园作业${title}到2027年1月9日`,
        useContext: true,
      },
    });
    expect((await suggestion.json()).actionLink.href).toContain("edit=");
    expect((await (await actor.api.get("/api/campus")).json()).state.revision).toBe(revision);
    const file = await actor.api.post("/api/campus/import", {
      multipart: {
        file: {
          name: "notice.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("作业2027年1月9日提交", "utf8"),
        },
      },
    });
    expect(file.ok(), await file.text()).toBe(true);
    expect((await file.json()).drafts[0].end).toBe("2027-01-09");
    expect((await (await actor.api.get("/api/campus")).json()).state.revision).toBe(revision);
  } finally {
    await actor.api.dispose();
  }
});
