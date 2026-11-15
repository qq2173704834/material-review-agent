import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  database,
  draft,
  noticeContent,
  publish,
  unique,
} from "../helpers/platform-boundaries";
import type { NoticeContent } from "../../src/lib/server/exam-store";
import type { ReviewTaskDetails } from "../../src/domain/review";

const invalidPublications: Array<[string, Partial<NoticeContent>, RegExp]> = [
  [
    "不存在的日期",
    { timeline: [{ label: "报名开始", value: "2027-02-30", quote: "合成通知" }] },
    /日期不存在/,
  ],
  [
    "开始晚于截止",
    {
      timeline: [
        { label: "报名开始", value: "2027-03-21", quote: "合成通知" },
        { label: "报名截止", value: "2027-03-20", quote: "合成通知" },
      ],
    },
    /开始晚于截止/,
  ],
  [
    "日期缺少原文引用",
    { timeline: [{ label: "报名开始", value: "2027-03-01", quote: "" }] },
    /原文中定位/,
  ],
  [
    "引用不属于正文",
    { timeline: [{ label: "报名开始", value: "2027-03-01", quote: "不存在的原文引用" }] },
    /原文中定位/,
  ],
  [
    "同名时间节点重复",
    {
      timeline: [
        { label: "报名开始", value: "", quote: "" },
        { label: "报名开始", value: "", quote: "" },
      ],
    },
    /时间节点重复/,
  ],
  [
    "完整时间未采用北京时间偏移",
    { timeline: [{ label: "报名开始", value: "2027-03-01T00:00:00Z", quote: "合成通知" }] },
    /带\+08:00/,
  ],
  ["有摘要但无人群限制", { audience: "" }, /适用人群/],
];
for (const [name, overrides, message] of invalidPublications) {
  test(`公告审核拒绝${name}，仍保留为不可见草稿`, async ({ actors }) => {
    const item = await draft(actors.admin, noticeContent(overrides));
    const response = await actors.admin.api.post("/api/admin/exams", {
      data: { action: "publish", id: item.id, version: 1 },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(message);
    expect((await actors.student.api.get(`/exams/${item.id}`)).status()).toBe(404);
  });
}

test("日期未知允许发布并明确未知；仅有日期不推断具体报名时刻", async ({ actors }) => {
  const unknown = await draft(
    actors.admin,
    noticeContent({
      timeline: [{ label: "报名开始", value: "", quote: "" }],
    }),
  );
  await publish(actors.admin, unknown.id);
  expect(await (await actors.student.api.get(`/exams/${unknown.id}`)).text()).toContain(
    "时间待确认",
  );
  const datesOnly = await draft(actors.admin);
  await publish(actors.admin, datesOnly.id);
  expect(await (await actors.student.api.get(`/exams/${datesOnly.id}`)).text()).toContain(
    "仅日期，具体时刻未公布",
  );
});

test("延期与取消公告显示处置状态，不依据旧时间宣称报名开放", async ({ actors }) => {
  for (const disposition of ["延期", "取消"] as const) {
    const item = await draft(actors.admin, noticeContent({ disposition }));
    await publish(actors.admin, item.id);
    const html = await (await actors.student.api.get(`/exams/${item.id}`)).text();
    expect(html).toContain(disposition);
    expect(html).not.toContain("处于公布的报名时段");
  }
});

test("管理员必须明确审核版本，普通用户不能伪造发布请求", async ({ actors }) => {
  const item = await draft(actors.admin);
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", { data: { action: "publish", id: item.id } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await actors.student.api.post("/api/admin/exams", {
        data: { action: "publish", id: item.id, version: 1 },
      })
    ).status(),
  ).toBe(403);
  expect((await actors.student.api.get(`/exams/${item.id}`)).status()).toBe(404);
});

test("同地址仅片段变化不增加版本，正文变化新增版本且保持旧发布快照", async ({ actors }) => {
  const content = noticeContent();
  const first = await draft(actors.admin, content);
  await publish(actors.admin, first.id);
  const duplicate = await draft(actors.admin, content, first.url + "#fragment");
  expect(duplicate).toMatchObject({ id: first.id, changed: false });
  const secret = unique("未审核内容");
  await draft(actors.admin, { ...content, text: secret }, first.url);
  const html = await (await actors.student.api.get(`/exams/${first.id}`)).text();
  expect(html).toContain(content.text);
  expect(html).not.toContain(secret);
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: { action: "publish", id: first.id, version: 1 },
      })
    ).status(),
  ).toBe(400);
});

test("公开历史只包含实际发布版本，跳过的中间草稿不泄露", async ({ actors }) => {
  const content = noticeContent();
  const first = await draft(actors.admin, content);
  await publish(actors.admin, first.id);
  const unpublished = unique("秘密草稿");
  await draft(actors.admin, { ...content, text: unpublished, timeline: [] }, first.url);
  const finalText = unique("正式更正");
  await draft(actors.admin, { ...content, text: finalText, timeline: [] }, first.url);
  await publish(actors.admin, first.id, 3);
  const html = await (await actors.student.api.get(`/exams/${first.id}`)).text();
  expect(html).toContain(content.text);
  expect(html).toContain(finalText);
  expect(html).not.toContain(unpublished);
});

test("撤回时存在更新草稿也保留原发布版本，收藏不泄露新草稿", async ({ actors }) => {
  const content = noticeContent();
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } });
  const secret = unique("撤回时未审核标题");
  await draft(actors.admin, { ...content, title: secret }, item.url);
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: { action: "withdraw", id: item.id, version: 2 },
      })
    ).status(),
  ).toBe(200);
  expect((await actors.student.api.get(`/exams/${item.id}`)).status()).toBe(404);
  const dashboard = await (await actors.student.api.get("/me?view=favorites")).text();
  expect(dashboard).toContain(content.title);
  expect(dashboard).toContain("已撤回");
  expect(dashboard).not.toContain(secret);
});

test("公告及附件地址拒绝同主机伪装、私网、凭据和非默认端口", async ({ actors }) => {
  const sources = await (await actors.admin.api.get("/api/admin/exams")).json();
  const source = sources.sources.find((s: { category: string }) => s.category === "cet4");
  for (const url of [
    "http://cet.neea.edu.cn/synthetic.html",
    "https://cet.neea.edu.cn.evil.example/synthetic.html",
    "https://127.0.0.1/synthetic.html",
    "https://student:secret@cet.neea.edu.cn/synthetic.html",
    "https://cet.neea.edu.cn:8443/synthetic.html",
  ]) {
    const response = await actors.admin.api.post("/api/admin/exams", {
      data: { action: "draft", sourceId: source.id, url, content: noticeContent() },
    });
    expect(response.status(), url).toBe(400);
  }
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: {
          action: "draft",
          sourceId: source.id,
          url: "https://cet.neea.edu.cn/synthetic.html",
          content: noticeContent({
            attachments: [
              { url: "https://evil.example/a.pdf", name: "伪造附件", status: "仅官方链接，未读取" },
            ],
          }),
        },
      })
    ).status(),
  ).toBe(400);
});

test("草稿不能收藏或创建预审任务，撤回后不能新建任务但允许取消收藏", async ({ actors }) => {
  const item = await draft(actors.admin);
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, {
        data: { action: "task", stage: "报名" },
      })
    ).status(),
  ).toBe(404);
  await publish(actors.admin, item.id);
  await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } });
  await actors.admin.api.post("/api/admin/exams", {
    data: { action: "withdraw", id: item.id, version: 1 },
  });
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, {
        data: { action: "task", stage: "报名" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "unfavorite" } })
    ).status(),
  ).toBe(200);
});

test("收藏已阅状态按用户独立，重复收藏不能吞掉尚未阅读的更新提醒", async ({ actors }) => {
  const content = noticeContent();
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  for (const actor of [actors.student, actors.peer])
    expect(
      (await actor.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } })).status(),
    ).toBe(200);
  await draft(actors.admin, { ...content, text: content.text + "更正要求。" }, item.url);
  await publish(actors.admin, item.id, 2);
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } })
    ).status(),
  ).toBe(200);
  const unreadDb = database();
  try {
    expect(
      unreadDb
        .prepare("SELECT seen_version FROM exam_favorites WHERE user_id=? AND notice_id=?")
        .get(actors.student.id, item.id),
    ).toEqual({ seen_version: 1 });
  } finally {
    unreadDb.close();
  }
  expect(
    (await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "seen" } })).status(),
  ).toBe(200);
  const db = database();
  try {
    expect(
      db
        .prepare("SELECT seen_version FROM exam_favorites WHERE user_id=? AND notice_id=?")
        .get(actors.student.id, item.id),
    ).toEqual({ seen_version: 2 });
    expect(
      db
        .prepare("SELECT seen_version FROM exam_favorites WHERE user_id=? AND notice_id=?")
        .get(actors.peer.id, item.id),
    ).toEqual({ seen_version: 1 });
  } finally {
    db.close();
  }
});

test("收藏达到500条时重复收藏仍幂等，新收藏被拒绝，取消后可新增", async ({ actors }) => {
  const item = await draft(actors.admin);
  await publish(actors.admin, item.id);
  const db = database();
  const syntheticIds: string[] = [];
  try {
    // Seed capacity only; verify all mutations through the public API.
    db.transaction(() => {
      db.prepare("DELETE FROM exam_favorites WHERE user_id=?").run(actors.peer.id);
      const source = db.prepare("SELECT source_id FROM exam_notices WHERE id=?").get(item.id) as {
        source_id: string;
      };
      const insertNotice = db.prepare(
        "INSERT INTO exam_notices(id,source_id,canonical_url,created_at) VALUES (?,?,?,?)",
      );
      const insertFavorite = db.prepare(
        "INSERT INTO exam_favorites(user_id,notice_id,seen_version,seen_status) VALUES (?,?,1,'published')",
      );
      for (let index = 0; index < 499; index++) {
        const id = randomUUID();
        syntheticIds.push(id);
        insertNotice.run(
          id,
          source.source_id,
          `https://cet.neea.edu.cn/capacity/${id}`,
          new Date().toISOString(),
        );
        insertFavorite.run(actors.peer.id, id);
      }
      insertFavorite.run(actors.peer.id, item.id);
    })();
    expect(
      (
        await actors.peer.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } })
      ).status(),
    ).toBe(200);
    const another = await draft(actors.admin);
    await publish(actors.admin, another.id);
    expect(
      (
        await actors.peer.api.post(`/api/exams/${another.id}`, { data: { action: "favorite" } })
      ).status(),
    ).toBe(400);
    expect(
      db.prepare("SELECT COUNT(*) n FROM exam_favorites WHERE user_id=?").get(actors.peer.id),
    ).toEqual({ n: 500 });
    expect(
      (
        await actors.peer.api.post(`/api/exams/${item.id}`, { data: { action: "unfavorite" } })
      ).status(),
    ).toBe(200);
    expect(
      (
        await actors.peer.api.post(`/api/exams/${another.id}`, { data: { action: "favorite" } })
      ).status(),
    ).toBe(200);
  } finally {
    db.transaction(() => {
      for (const id of syntheticIds) {
        db.prepare("DELETE FROM exam_favorites WHERE notice_id=?").run(id);
        db.prepare("DELETE FROM exam_notices WHERE id=?").run(id);
      }
    })();
    db.close();
  }
});

test("累计超过100个草稿后，收藏仍显示发布快照且旧任务可以采用新版", async ({ actors }) => {
  const content = noticeContent();
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const taskResponse = await actors.student.api.post(`/api/exams/${item.id}`, {
    data: { action: "task", stage: "长期版本回归" },
  });
  expect(taskResponse.status()).toBe(201);
  const taskId: string = (await taskResponse.json()).taskId;
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } })
    ).status(),
  ).toBe(200);
  const secret = unique("长期未审核草稿");
  const db = database();
  try {
    const insert = db.prepare(
      "INSERT INTO exam_notice_versions(notice_id,version,payload,digest,actor,created_at) VALUES (?,?,?,?,?,?)",
    );
    db.transaction(() => {
      for (let version = 2; version <= 102; version++)
        insert.run(
          item.id,
          version,
          JSON.stringify({ ...content, title: `${secret}-${version}` }),
          `${item.id}-${version}`,
          actors.admin.id,
          new Date().toISOString(),
        );
    })();
  } finally {
    db.close();
  }
  const dashboard = await actors.student.api.get("/me?view=favorites");
  expect(dashboard.status()).toBe(200);
  const html = await dashboard.text();
  expect(html).toContain(content.title);
  expect(html).not.toContain(secret);
  expect(await (await actors.student.api.get(`/exams/${item.id}`)).text()).toContain(content.text);
  await publish(actors.admin, item.id, 102);
  expect(
    (
      await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "adopt", taskId } })
    ).status(),
  ).toBe(200);
  const task: ReviewTaskDetails = (
    await (await actors.student.api.get(`/api/tasks/${taskId}`)).json()
  ).task;
  expect(task.noticeSource.originalText).toBe(content.text);
  expect(task.supplementalSources).toHaveLength(1);
});

test("同公告不同阶段或对象分别建任务，同组合复用，删除后可以重新创建", async ({ actors }) => {
  const item = await draft(actors.admin);
  await publish(actors.admin, item.id);
  const path = `/api/exams/${item.id}`;
  const ids: string[] = [];
  for (const [stage, target] of [
    ["报名", "四级"],
    ["资格复审", "四级"],
    ["报名", "六级"],
  ]) {
    const response = await actors.student.api.post(path, {
      data: { action: "task", stage, target },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).taskId);
  }
  expect(new Set(ids).size).toBe(3);
  const reused = await actors.student.api.post(path, {
    data: { action: "task", stage: "报名", target: "四级" },
  });
  expect(await reused.json()).toMatchObject({ taskId: ids[0], reused: true });
  expect((await actors.student.api.delete(`/api/tasks/${ids[0]}`)).status()).toBe(204);
  const recreated = await actors.student.api.post(path, {
    data: { action: "task", stage: "报名", target: "四级" },
  });
  expect(recreated.status()).toBe(201);
  expect((await recreated.json()).taskId).not.toBe(ids[0]);
});

test("新版必须由所有者明确采用；重复采用不增来源，旧快照与原规则保留", async ({ actors }) => {
  const content = noticeContent();
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const linked = await actors.student.api.post(`/api/exams/${item.id}`, {
    data: { action: "task", stage: "报名" },
  });
  expect(linked.status()).toBe(201);
  const taskId = (await linked.json()).taskId;
  const before: ReviewTaskDetails = (
    await (await actors.student.api.get(`/api/tasks/${taskId}`)).json()
  ).task;
  expect((await actors.student.api.post(`/api/tasks/${taskId}/rules?mode=mock`)).status()).toBe(
    201,
  );
  const rulesBefore = await (await actors.student.api.get(`/api/tasks/${taskId}/rules`)).json();
  expect(rulesBefore.ruleSets.length).toBeGreaterThan(0);
  const run = await actors.student.api.post(`/api/tasks/${taskId}/checks?mode=mock`);
  expect(run.status()).toBe(200);
  await run.body();
  const executionBefore = (
    await (await actors.student.api.get(`/api/tasks/${taskId}/checks`)).json()
  ).executions[0];
  expect(executionBefore).toMatchObject({ status: "completed", validity: "current" });
  await draft(actors.admin, { ...content, text: content.text + "更正：增加在读证明。" }, item.url);
  await publish(actors.admin, item.id, 2);
  expect(
    (await (await actors.student.api.get(`/api/tasks/${taskId}`)).json()).task.supplementalSources,
  ).toEqual(before.supplementalSources);
  await actors.student.api.patch(`/api/tasks/${taskId}/access`, {
    data: { username: actors.peer.username, enabled: true },
  });
  expect(
    (
      await actors.peer.api.post(`/api/exams/${item.id}`, { data: { action: "adopt", taskId } })
    ).status(),
  ).toBe(400);
  for (let attempt = 0; attempt < 2; attempt++)
    expect(
      (
        await actors.student.api.post(`/api/exams/${item.id}`, {
          data: { action: "adopt", taskId },
        })
      ).status(),
    ).toBe(200);
  const after: ReviewTaskDetails = (
    await (await actors.student.api.get(`/api/tasks/${taskId}`)).json()
  ).task;
  expect(after.supplementalSources).toHaveLength(before.supplementalSources.length + 1);
  expect(after.noticeSource).toEqual(before.noticeSource);
  expect(await (await actors.student.api.get(`/api/tasks/${taskId}/rules`)).json()).toEqual(
    rulesBefore,
  );
  const executionAfter = (
    await (await actors.student.api.get(`/api/tasks/${taskId}/checks`)).json()
  ).executions[0];
  expect(executionAfter).toMatchObject({
    id: executionBefore.id,
    validity: "needs_recheck",
    results: executionBefore.results,
  });
  expect((await actors.student.api.post(`/api/tasks/${taskId}/checks?mode=mock`)).status()).toBe(
    409,
  );
  const db = database();
  try {
    expect(
      db.prepare("SELECT notice_version FROM exam_task_links WHERE task_id=?").get(taskId),
    ).toEqual({ notice_version: 2 });
  } finally {
    db.close();
  }
});

test("四六级共同公告同时匹配四级和六级，单独四级公告不进入六级筛选", async ({ page, actors }) => {
  const marker = unique("筛选");
  const combined = await draft(actors.admin, noticeContent({ title: `${marker}英语四六级通知` }));
  const onlyFour = await draft(actors.admin, noticeContent({ title: `${marker}英语四级单独通知` }));
  await publish(actors.admin, combined.id);
  await publish(actors.admin, onlyFour.id);
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto(`/exams?${new URLSearchParams({ q: marker, category: "cet6" })}`);
  await expect(page.locator("article").filter({ has: page.locator("h2") })).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: `${marker}英语四六级通知`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: `${marker}英语四级单独通知`, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "考试类别" }).selectOption("cet4");
  await page.getByRole("button", { name: "查找考试", exact: true }).click();
  await expect(page.locator("article").filter({ has: page.locator("h2") })).toHaveCount(2);
  await page.getByRole("combobox", { name: "适用地区" }).selectOption("广东");
  await page.getByRole("button", { name: "查找考试", exact: true }).click();
  await expect(page.getByRole("heading", { name: "没有匹配的考试公告" })).toBeVisible();
  await expect(page.locator("article").filter({ has: page.locator("h2") })).toHaveCount(0);
});
