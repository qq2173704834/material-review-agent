import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  createActor,
  draft,
  publish,
  noticeContent,
} from "../helpers/platform-boundaries";

test("BUG056 已有日期但目标未选考期：明确状态，选择公告后原目标与统一日程同步", async ({
  actors,
  playwright,
  page,
}) => {
  const actor = await createActor(playwright, "date_choice");
  const edition = `合成下半年-${randomUUID()}`;
  const content = noticeContent({
    edition,
    title: `合成四级日期-${randomUUID()}`,
    text: "合成笔试2027年12月12日，准考证12月1日9时起打印。须提交学籍证明。",
    timeline: [
      { label: "笔试", value: "2027-12-12", quote: "笔试2027年12月12日" },
      { label: "准考证", value: "2027-12-01T09:00:00+08:00", quote: "准考证12月1日9时起打印" },
    ],
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const response = await actor.api.post("/api/goals", {
    data: {
      goal: { category: "cet4", region: "全国", progress: "保留私人进度", minutesPerDay: 45 },
    },
  });
  expect(response.ok()).toBe(true);
  const original = (await response.json()).goal;
  expect(original.edition).toBe("待确认考期");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto(`/me/schedule?goal=${original.id}&pending=1`);
  const card = page.getByRole("article", { name: "大学英语四级 · 待确认考期", exact: true });
  await expect(card.getByText("尚未选择考期", { exact: true })).toBeVisible();
  await expect(card.getByText("时间待公布", { exact: true })).toHaveCount(0);
  await card.getByRole("link", { name: "选择考期", exact: true }).click();
  await expect(page.getByLabel("考期", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "关联公告", exact: true }).selectOption(item.id);
  await page.getByRole("button", { name: "保存目标", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/me/schedule\\?goal=${original.id}`));
  const saved = (await (await actor.api.get("/api/goals")).json()).goals;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    id: original.id,
    noticeId: item.id,
    edition,
    progress: "保留私人进度",
    minutesPerDay: 45,
  });
  const nodes = (await (await actor.api.get("/api/schedule")).json()).nodes;
  expect(nodes).toHaveLength(2);
  expect(nodes.map((node: { value: string }) => node.value)).toEqual([
    "2027-12-01T09:00:00+08:00",
    "2027-12-12",
  ]);
  for (const node of nodes) expect(node.goalIds).toContain(original.id);
  await expect(page.getByText("2027-12-12 · 仅日期", { exact: false })).toBeVisible();
  expect(
    (await (await actors.peer.api.get("/api/schedule")).json()).nodes.some(
      (node: { goalIds: string[] }) => node.goalIds.includes(original.id),
    ),
  ).toBe(false);
  await page.goto("/me");
  await expect(page.getByText("笔试：2027-12-12", { exact: true })).toBeVisible();
  await actor.api.dispose();
});

test("BUG056 已选考期却无公告和公告确实未给日期保持不同提示，不猜测别场日期", async ({
  actors,
  playwright,
  page,
}) => {
  const actor = await createActor(playwright, "date_missing");
  const missing = (
    await (
      await actor.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", edition: `无来源-${randomUUID()}` } },
      })
    ).json()
  ).goal;
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto(`/me/schedule?goal=${missing.id}&pending=1`);
  await expect(page.getByText("尚未关联考试公告", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "关联考试公告", exact: true })).toBeVisible();
  const content = noticeContent({
    edition: `尚未公布-${randomUUID()}`,
    text: "合成笔试时间另行公布。须提交学籍证明。",
    timeline: [{ label: "笔试", value: "", quote: "笔试时间另行公布" }],
  });
  const item = await draft(actors.admin, content);
  await publish(actors.admin, item.id);
  const known = (
    await (
      await actor.api.post("/api/goals", {
        data: { goal: { category: "cet4", region: "全国", noticeId: item.id } },
      })
    ).json()
  ).goal;
  await page.goto(`/me/schedule?goal=${known.id}&pending=1`);
  await expect(page.getByText("考试日期未收录", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "选择考期", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "查看来源", exact: true })).toHaveAttribute(
    "href",
    new RegExp(`/exams/${item.id}`),
  );
  await actor.api.dispose();
});
