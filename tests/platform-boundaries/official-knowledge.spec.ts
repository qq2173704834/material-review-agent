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
  expect(officialKnowledge.entries).toHaveLength(35);
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
