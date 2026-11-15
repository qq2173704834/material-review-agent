import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  draft,
  publish,
  noticeContent,
  database,
} from "../helpers/platform-boundaries";

test("目标无需收藏即显示节点，已读按账号和版本隔离，归档移除提醒", async ({ actors, page }) => {
  const future =
    new Date(Date.now() + 3 * 86400000 + 8 * 3600000).toISOString().slice(0, 19) + "+08:00";
  const content = noticeContent({
    title: `目标提醒-${randomUUID()}`,
    text: `合成考试日期${future}，需核对证件。`,
    timeline: [{ label: "笔试", value: future, quote: future }],
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const goalInput = {
    category: "cet4",
    region: "全国",
    edition: content.edition,
    noticeId: item.id,
  };
  const goal = (
    await (await actors.student.api.post("/api/goals", { data: { goal: goalInput } })).json()
  ).goal;
  const get = async (
    api: typeof actors.student.api,
  ): Promise<Array<{ id: string; read: boolean; version: number }>> =>
    (await (await api.get("/api/reminders")).json()).reminders;
  expect(await get(actors.student.api)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: item.id, read: false, version: 1 })]),
  );
  expect(await get(actors.peer.api)).toHaveLength(0);
  expect(
    (await actors.peer.api.post("/api/reminders", { data: { id: item.id, version: 1 } })).status(),
  ).toBe(400);
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  await page.goto("/me/schedule");
  const nodes = page.getByRole("article", { name: content.title });
  await expect(nodes.getByText(content.title, { exact: true })).toBeVisible();
  // Reading remains a legacy API state; the unified schedule tracks completion separately.
  expect(
    (await actors.student.api.post("/api/reminders", { data: { id: item.id, version: 1 } })).ok(),
  ).toBeTruthy();
  await expect.poll(async () => (await get(actors.student.api))[0]?.read).toBe(true);
  await expect(nodes.getByRole("button", { name: "完成", exact: true })).toBeVisible();
  await actors.peer.api.post("/api/goals", { data: { goal: goalInput } });
  expect((await get(actors.peer.api))[0]?.read).toBe(false);
  const db = database();
  try {
    expect(
      db
        .prepare("SELECT COUNT(*) count FROM exam_favorites WHERE user_id=? AND notice_id=?")
        .get(actors.student.id, item.id),
    ).toMatchObject({ count: 0 });
  } finally {
    db.close();
  }
  await draft(actors.admin, { ...content, text: content.text + " 修订材料说明。" }, item.url);
  await publish(actors.admin, item.id, 2);
  expect((await get(actors.student.api))[0]).toMatchObject({ version: 2, read: false });
  expect(
    (
      await actors.student.api.post("/api/reminders", { data: { id: item.id, version: 1 } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await actors.student.api.post("/api/goals", {
        data: { id: goal.id, goal: { ...goalInput, state: "archived" } },
      })
    ).status(),
  ).toBe(200);
  expect(await get(actors.student.api)).toHaveLength(0);
});
