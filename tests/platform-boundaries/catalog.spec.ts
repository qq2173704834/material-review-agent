import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  draft,
  publish,
  noticeContent,
  database,
} from "../helpers/platform-boundaries";

test("同范围知识冲突保留双方引用，撤回即时生效，检索核查定位坏快照", async ({ actors }) => {
  const first = randomUUID(),
    second = randomUUID(),
    broken = randomUUID();
  const db = database();
  const content = {
    title: "合成DELE报名政策",
    category: "dele",
    region: "全国",
    edition: "2035年",
    kind: "knowledge",
    author: "合成测试单位",
    url: "https://dele.neea.edu.cn/",
    text: "合成DELE报名政策：报名需核对个人证明。",
    checkedAt: "2026-11-14",
    scope: "同一范围",
    disposition: "现行",
    reviewNote: "合成隔离测试依据，非真实政策。",
  };
  const insert = (id: string, payload: object): void => {
    db.prepare(
      "INSERT INTO portal_content(id,kind,status,version,published_version,updated_at) VALUES (?,'knowledge','published',1,1,?)",
    ).run(id, new Date().toISOString());
    db.prepare(
      "INSERT INTO portal_content_versions(content_id,version,payload,actor,created_at) VALUES (?,1,?,'synthetic-test',?)",
    ).run(id, JSON.stringify(payload), new Date().toISOString());
  };
  try {
    insert(first, { ...content, conflictsWith: [second] });
    insert(second, { ...content, text: "合成DELE报名政策：报名不需个人证明。" });
    const ask = async (): Promise<{ kind: string; citations: Array<{ id: string }> }> => {
      const response = await actors.student.api.post("/api/assistant", {
        data: { requestId: randomUUID(), question: "2035年DELE报名政策是什么" },
      });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };
    const answer = await ask();
    expect(answer.kind).toBe("需补充信息");
    expect(answer.citations.map((item) => item.id)).toEqual(
      expect.arrayContaining([first, second]),
    );
    expect(
      (
        await actors.admin.api.post("/api/admin/learning", {
          data: { action: "withdraw", id: second, version: 1 },
        })
      ).status(),
    ).toBe(200);
    expect((await ask()).kind).not.toBe("需补充信息");
    insert(broken, { title: "合成损坏快照" });
    expect(
      (
        await actors.student.api.post("/api/admin/learning", { data: { action: "check-index" } })
      ).status(),
    ).toBe(403);
    const check = await actors.admin.api.post("/api/admin/learning", {
      data: { action: "check-index" },
    });
    expect(check.status()).toBe(200);
    expect((await check.json()).indexCheck.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: broken, version: 1 })]),
    );
    expect(
      JSON.parse(
        (
          db
            .prepare("SELECT payload FROM portal_content_versions WHERE content_id=?")
            .get(broken) as { payload: string }
        ).payload,
      ),
    ).toEqual({ title: "合成损坏快照" });
  } finally {
    db.prepare("DELETE FROM portal_content WHERE id IN (?,?,?)").run(first, second, broken);
    db.close();
  }
});

test("多考试和等级科目筛选共用公告与收藏对象，非法分类由服务端拒绝", async ({ actors, page }) => {
  const content = noticeContent({
    title: `合成联合多维公告-${randomUUID()}`,
    category: "ncre",
    categories: ["cet6"],
    levels: ["二级"],
    subjects: ["Python"],
    languages: ["英语"],
    examForms: ["机考"],
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  for (const category of ["ncre", "cet6"]) {
    await page.goto(
      `/exams?category=${category}&level=${encodeURIComponent("二级")}&subject=python&examForm=${encodeURIComponent("机考")}`,
    );
    await expect(page.getByRole("heading", { name: content.title, exact: true })).toBeVisible();
    expect(
      (
        await actors.student.api.post(`/api/exams/${item.id}`, { data: { action: "favorite" } })
      ).ok(),
    ).toBeTruthy();
  }
  const db = database();
  try {
    expect(
      db
        .prepare("SELECT COUNT(*) count FROM exam_favorites WHERE notice_id=? AND user_id=?")
        .get(item.id, actors.student.id),
    ).toMatchObject({ count: 1 });
  } finally {
    db.close();
  }
  await page.goto(`/exams?category=ncre&level=${encodeURIComponent("一级")}`);
  await expect(page.getByRole("heading", { name: content.title, exact: true })).toHaveCount(0);
  await page.goto(`/exams/${item.id}`);
  await expect(page.getByText(/等级：二级/)).toBeVisible();
  const sources = (await (await actors.admin.api.get("/api/admin/exams")).json()).sources;
  const source = sources.find((entry: { category: string }) => entry.category === "cet4");
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: {
          action: "draft",
          sourceId: source.id,
          url: `https://cet.neea.edu.cn/synthetic-invalid-${randomUUID()}`,
          content: { ...content, categories: ["not-an-exam"] },
        },
      })
    ).status(),
  ).toBe(400);
});

test("发布的停办依据影响目录、报名状态和自动预审，撤回后保留历史且解除当前拦截", async ({
  actors,
  page,
}) => {
  const title = `合成当前书画公告-${randomUUID()}`;
  const content = noticeContent({
    title,
    category: "ccpt",
    text: "合成报名范围：2020-01-01T00:00:00+08:00至2040-12-31T23:00:00+08:00。",
    timeline: [
      { label: "报名开始", value: "2020-01-01T00:00:00+08:00", quote: "2020-01-01T00:00:00+08:00" },
      { label: "报名截止", value: "2040-12-31T23:00:00+08:00", quote: "2040-12-31T23:00:00+08:00" },
    ],
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const id = randomUUID(),
    db = database();
  const evidence = {
    title: `合成停办依据-${id}`,
    category: "ccpt",
    region: "全国",
    kind: "knowledge",
    author: "合成机构",
    url: "https://ccpt.neea.edu.cn/",
    text: "合成停办规定，仅供回归。",
    checkedAt: "2026-11-14",
    scope: "全国合成状态",
    disposition: "现行",
    catalogStatus: "停办",
    catalogEffectiveAt: "2026-01-01",
    reviewNote: "仅供隔离工程回归的合成审核记录。",
  };
  try {
    const invalid = await actors.admin.api.post("/api/admin/learning", {
      data: { action: "draft", content: { ...evidence, kind: "resource" } },
    });
    expect(invalid.status()).toBe(400);
    db.prepare(
      "INSERT INTO portal_content(id,kind,status,version,published_version,updated_at) VALUES (?,'knowledge','published',1,1,?)",
    ).run(id, new Date().toISOString());
    db.prepare(
      "INSERT INTO portal_content_versions(content_id,version,payload,actor,created_at) VALUES (?,1,?,'synthetic-test',?)",
    ).run(id, JSON.stringify(evidence), new Date().toISOString());
    await page.context().addCookies((await actors.student.api.storageState()).cookies);
    await page.goto(`/exams/${item.id}`);
    await expect(page.getByText(/目录状态：停办/)).toBeVisible();
    await expect(page.getByText("可报名", { exact: true })).toHaveCount(0);
    await page.goto("/exams?category=ccpt");
    await expect(page.getByRole("link", { name: /状态依据：合成停办依据/ })).toBeVisible();
    const goal = (
      await (
        await actors.student.api.post("/api/goals", {
          data: {
            goal: { category: "ccpt", region: "全国", edition: content.edition, noticeId: item.id },
          },
        })
      ).json()
    ).goal;
    const blocked = await actors.student.api.post("/api/goals/review", {
      data: { goalId: goal.id, auto: true },
    });
    expect(blocked.status()).toBe(400);
    expect((await blocked.json()).error).toContain("停办");
    expect(
      (
        await actors.admin.api.post("/api/admin/learning", {
          data: { action: "withdraw", id, version: 1 },
        })
      ).status(),
    ).toBe(200);
    await page.goto(`/exams/${item.id}`);
    await expect(page.getByText(/目录状态：停办/)).toHaveCount(0);
    expect(
      (
        await actors.student.api.post("/api/goals/review", {
          data: { goalId: goal.id, auto: true },
        })
      ).status(),
    ).toBe(200);
    expect((await actors.student.api.get(`/learn/${id}`)).status()).toBe(200);
  } finally {
    db.close();
  }
});

test("来源组织关系保存与采集开关分离，非法主机和伪引用被拒绝，普通用户不能维护", async ({
  actors,
}) => {
  const source = (await (await actors.admin.api.get("/api/admin/exams")).json()).sources[0];
  const provenance = {
    organizer: "合成组织",
    relationship: "主办机构",
    referenceUrl: "https://127.0.0.1/",
    quote: "此句并非真实原文关系依据。",
    result: "已核对",
  };
  expect(
    (
      await actors.student.api.post("/api/admin/exams", {
        data: { action: "source-proof", id: source.id, provenance },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: { action: "source-proof", id: source.id, provenance },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await actors.admin.api.post("/api/admin/exams", {
        data: {
          action: "source-proof",
          id: source.id,
          provenance: { ...provenance, relationship: "待核实" },
        },
      })
    ).status(),
  ).toBe(400);
  const refreshed = (await (await actors.admin.api.get("/api/admin/exams")).json()).sources.find(
    (entry: { id: string }) => entry.id === source.id,
  );
  expect(refreshed.enabled).toBe(source.enabled);
  expect(refreshed.provenance).toEqual(source.provenance);
});
