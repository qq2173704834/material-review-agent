import { createHash, randomUUID } from "node:crypto";
import officialKnowledge from "../../src/domain/official-knowledge.json" with { type: "json" };
import {
  test,
  expect,
  database,
  draft,
  publish,
  noticeContent,
} from "../helpers/platform-boundaries";

test("官方引用知识可检索，考纲说明保留阅读边界，种子不覆盖草稿或复活撤回", async ({
  actors,
  page,
}) => {
  const entries = (await (await actors.admin.api.get("/api/admin/learning")).json()).entries;
  expect(officialKnowledge.entries).toHaveLength(81);
  for (const record of officialKnowledge.entries) {
    const id = createHash("sha256")
      .update("official-knowledge:" + record.key)
      .digest("hex")
      .slice(0, 32);
    expect(entries.find((entry: { id: string }) => entry.id === id)).toMatchObject({
      status: "published",
      version: 1,
      content: record.content,
    });
  }
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto("/exams?category=teacher#exam-directory");
  const facts = page.getByTestId("exam-facts-teacher");
  await facts.locator("summary").click();
  await expect(facts.getByText("通用介绍，非当期公告", { exact: false }).first()).toBeVisible();
  await expect(
    facts.getByRole("link", { name: "教师资格考试合格证明与认定", exact: true }),
  ).toBeVisible();
  await expect(facts.getByText(/不是个人资格结论/)).toBeVisible();
  const fund = entries.find(
    (entry: { content: { title: string } }) => entry.content.title === "基金新细则报名条件",
  );
  await page.goto(`/learn/${fund.id}`);
  await expect(page.getByRole("heading", { name: "基金新细则报名条件" })).toBeVisible();
  await expect(page.getByText(/报名截止日时年满 18 周岁/)).toBeVisible();
  await expect(page.getByText(/第3页少量引用/)).toBeVisible();
  await expect(page.getByRole("link", { name: "前往原始来源" }).first()).toHaveAttribute(
    "href",
    /P020261113578939174273\.pdf/,
  );
  await page.goto("/learn?q=NCRE官方考纲");
  await page.getByRole("link", { name: "NCRE官方考纲与教材目录", exact: true }).click();
  await expect(page.getByText(/PDF大纲未下载解析/)).toBeVisible();
  await expect(
    page.getByText("二级Python语言程序设计考试大纲（2025年版）", { exact: true }),
  ).toBeVisible();
  const title = `合成通用知识配合当期公告-${randomUUID()}`;
  const content = noticeContent({
    title,
    edition: "2037年",
    year: 2037,
    text: "合成报名条件：2037年大学英语四级报考需核对当期学籍材料。",
    timeline: [],
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const goal = (
    await (
      await actors.student.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", edition: "2037年", noticeId: item.id } },
      })
    ).json()
  ).goal;
  const answer = await actors.student.api.post("/api/assistant", {
    data: {
      requestId: randomUUID(),
      question: "报名条件和材料是什么",
      goalId: goal.id,
      useContext: true,
    },
  });
  expect(answer.status(), await answer.text()).toBe(200);
  const payload = await answer.json();
  expect(payload.mode).toBe("mock");
  expect(payload.citations.some((entry: { id: string }) => entry.id === item.id)).toBe(true);
  const target = entries.find(
    (entry: { content: { title: string } }) => entry.content.title === "NCRE官方FAQ：证书有效期",
  );
  expect(
    (
      await actors.admin.api.post("/api/admin/learning", {
        data: {
          action: "draft",
          id: target.id,
          version: 1,
          content: { ...target.content, title: "合成待核对修订" },
        },
      })
    ).status(),
  ).toBe(200);
  const db = database();
  try {
    await actors.admin.api.get("/api/admin/learning");
    expect(
      db.prepare("SELECT version,published_version FROM portal_content WHERE id=?").get(target.id),
    ).toMatchObject({ version: 2, published_version: 1 });
    expect(
      (
        await actors.admin.api.post("/api/admin/learning", {
          data: { action: "withdraw", id: target.id, version: 2 },
        })
      ).status(),
    ).toBe(200);
    await actors.admin.api.get("/api/admin/learning");
    expect(db.prepare("SELECT status FROM portal_content WHERE id=?").get(target.id)).toMatchObject(
      { status: "withdrawn" },
    );
    expect(await (await actors.student.api.get(`/learn/${target.id}`)).text()).toContain(
      "该资料已撤回",
    );
  } finally {
    db.close();
  }
});

test("北京2026资格原文保留地区年份，其他地区或考期不引用北京条件", async ({ actors }) => {
  const local = await actors.student.api.post("/api/assistant", {
    data: {
      requestId: randomUUID(),
      question: "北京2026年执业药师的岗位工作年限条件是什么？",
      learning: false,
      allowExternal: false,
    },
  });
  expect(local.status()).toBe(200);
  const answer = await local.json();
  expect(answer.mode).toBe("mock");
  expect(answer.citations.length).toBeGreaterThan(0);
  expect(
    answer.citations.every((c: { scope: string }) => c.scope.startsWith("北京 · 2026年 ·")),
  ).toBe(true);
  for (const question of [
    "上海2026年执业药师的岗位工作年限条件是什么？",
    "北京2027年执业药师的岗位工作年限条件是什么？",
  ]) {
    const response = await actors.student.api.post("/api/assistant", {
      data: { requestId: randomUUID(), question, learning: false, allowExternal: false },
    });
    expect(response.status()).toBe(200);
    const other = await response.json();
    expect(other.kind).toBe("需补充信息");
    expect(other.citations).toHaveLength(0);
  }
});

test("非官方资料显著标识、政策仅参考且不能单独改变举办状态", async ({ actors, page }) => {
  const entries = (await (await actors.admin.api.get("/api/admin/learning")).json()).entries;
  const secondary = entries.find(
    (entry: { content: { sourceType?: string; category: string } }) =>
      entry.content.sourceType === "非官方参考" && entry.content.category === "valuation",
  );
  expect(secondary).toBeTruthy();
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto(`/learn/${secondary.id}`);
  await expect(page.getByRole("note")).toContainText("非官方参考");
  await page.goto("/exams?category=valuation#exam-directory");
  const facts = page.getByTestId("exam-facts-valuation");
  await facts.locator("summary").click();
  await expect(facts.getByText("非官方参考 · 政策待核实").first()).toBeVisible();
  const response = await actors.student.api.post("/api/assistant", {
    data: {
      requestId: randomUUID(),
      question: "2026年资产评估师的学生报名条件与获证条件是什么？",
      allowExternal: true,
    },
  });
  expect(response.status()).toBe(200);
  const answer = await response.json();
  expect(answer).toMatchObject({
    kind: "需补充信息",
    mode: "retrieval",
    usage: { modelCall: null },
  });
  expect(answer.warning).toContain("非官方参考");
  expect(answer.citations.length).toBeGreaterThan(0);
  expect(
    answer.citations.every((c: { sourceType?: string }) => c.sourceType === "非官方参考"),
  ).toBe(true);
  const bad = await actors.admin.api.post("/api/admin/learning", {
    data: {
      action: "draft",
      id: secondary.id,
      version: secondary.version,
      content: { ...secondary.content, catalogStatus: "停办", catalogEffectiveAt: "2026-11-14" },
    },
  });
  expect(bad.status()).toBe(400);
  const db = database();
  try {
    const key = randomUUID();
    const content = { ...secondary.content, category: "ncre", title: "合成第三方NCRE资格参考" };
    db.prepare(
      "INSERT INTO portal_content(id,kind,status,version,published_version,updated_at) VALUES (?,'knowledge','published',1,1,?)",
    ).run(key, new Date().toISOString());
    db.prepare(
      "INSERT INTO portal_content_versions(content_id,version,payload,actor,created_at) VALUES (?,1,?,'test',?)",
    ).run(key, JSON.stringify(content), new Date().toISOString());
    const official = await actors.student.api.post("/api/assistant", {
      data: { requestId: randomUUID(), question: "2026年全国计算机等级考试的报名条件是什么？" },
    });
    const primary = await official.json();
    expect(official.status()).toBe(200);
    expect(primary.citations.length).toBeGreaterThan(0);
    expect(primary.citations.some((c: { id: string }) => c.id === key)).toBe(false);
  } finally {
    db.close();
  }
});
