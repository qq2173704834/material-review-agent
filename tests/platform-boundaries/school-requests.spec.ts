import { randomUUID } from "node:crypto";
import type { APIResponse } from "@playwright/test";
import { test, expect, createActor, database } from "../helpers/platform-boundaries";

test("学校名称片段可直接选中已有学校，不提交申请；未收录学校仅名称即可申请", async ({
  actors,
  playwright,
  page,
}) => {
  const actor = await createActor(playwright, "school_name");
  await page.context().addCookies((await actor.api.storageState()).cookies);
  await page.goto("/campus");
  await page.getByText("没有找到学校？申请添加学校", { exact: true }).click();
  await page.getByLabel("学校名称", { exact: true }).fill("第二工业大学");
  await page.getByRole("button", { name: "选择上海第二工业大学", exact: true }).click();
  await expect(page.getByRole("heading", { name: "上海第二工业大学", exact: true })).toBeVisible();
  expect((await (await actor.api.get("/api/campus")).json()).state.preferences.schoolId).toBe(
    "sspu",
  );
  const db = database();
  expect(
    db.prepare("SELECT COUNT(*) n FROM campus_school_requests_v2 WHERE user_id=?").get(actor.id),
  ).toMatchObject({ n: 0 });
  db.close();
  const name = `合成新校-${randomUUID()}`;
  await page.getByLabel("学校名称", { exact: true }).fill(name);
  await expect(page.getByLabel("学校官网（选填）", { exact: true })).not.toHaveAttribute(
    "required",
  );
  await page.getByRole("button", { name: "申请添加学校", exact: true }).click();
  await expect(
    page.getByText("学校添加申请已提交，维护人员会核对并补充通知来源。你可以先使用个人日程。", {
      exact: true,
    }),
  ).toBeVisible();
  const saved = (await (await actors.admin.api.get("/api/admin/campus")).json()).requests;
  expect(saved).toEqual(expect.arrayContaining([expect.objectContaining({ name, url: "" })]));
  expect((await (await actor.api.get("/api/campus")).json()).state.preferences.schoolId).toBe(
    "sspu",
  );
  await actor.api.dispose();
});

test("官网选填支持多所学校、重复申请幂等及后补官网，配额和接口门禁保留", async ({
  actors,
  playwright,
}) => {
  const actor = await createActor(playwright, "school_requests");
  const send = (name: string, url?: string): Promise<APIResponse> =>
    actor.api.post("/api/campus/school-request", {
      data: { name, ...(url !== undefined ? { url } : {}) },
    });
  const prefix = `合成-${randomUUID()}`;
  for (let i = 0; i < 10; i++)
    expect((await send(`${prefix}-${i}`, i % 2 ? "" : undefined)).ok()).toBe(true);
  expect((await send(`${prefix}-0`, "https://example.edu.cn/")).ok()).toBe(true);
  expect((await send(` ${prefix}-0 `, "")).ok()).toBe(true);
  expect((await send(`${prefix}-extra`)).status()).toBe(400);
  const db = database();
  const rows = db
    .prepare("SELECT name,url FROM campus_school_requests_v2 WHERE user_id=?")
    .all(actor.id);
  expect(rows).toHaveLength(10);
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: `${prefix}-0`, url: "https://example.edu.cn/" }),
    ]),
  );
  db.close();
  for (const url of [
    "not-url",
    "http://example.edu.cn/",
    "https://user:password@example.edu.cn/",
    "javascript:alert(1)",
  ])
    expect((await send("合成无效官网", url)).status()).toBe(400);
  expect((await send(" ")).status()).toBe(400);
  expect((await actor.api.get("/api/admin/campus")).status()).toBe(403);
  const guest = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3132" });
  expect(
    (await guest.post("/api/campus/school-request", { data: { name: prefix } })).status(),
  ).toBe(401);
  await guest.dispose();
  expect(
    (
      await actors.peer.api.post("/api/campus/school-request", { data: { name: `${prefix}-peer` } })
    ).ok(),
  ).toBe(true);
  await actor.api.dispose();
});

test("原学校申请重复迁移保留官网、名称与时间，管理员能看到旧申请", async ({
  actors,
  playwright,
}) => {
  const actor = await createActor(playwright, "school_legacy");
  await actor.api.get("/api/campus");
  const name = `合成旧申请-${randomUUID()}`;
  const db = database();
  db.prepare(
    "INSERT INTO campus_school_requests(user_id,url,name,created_at) VALUES (?,?,?,?)",
  ).run(actor.id, "https://legacy.example.edu.cn/", name, "2026-11-10T00:00:00Z");
  db.close();
  for (let i = 0; i < 2; i++) {
    const requests = (
      await (await actors.admin.api.get("/api/admin/campus")).json()
    ).requests.filter((item: { name: string }) => item.name === name);
    expect(requests).toEqual([
      { name, url: "https://legacy.example.edu.cn/", created_at: "2026-11-10T00:00:00Z" },
    ]);
  }
  await actor.api.dispose();
});
