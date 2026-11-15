import {
  test,
  expect,
  createTask,
  draft,
  noticeContent,
  publish,
  unique,
  database,
} from "../helpers/platform-boundaries";

test("真实原件按任务授权隔离，下载和Range读取均不能绕过撤销权限", async ({ actors }) => {
  const { student, peer, admin } = actors;
  const taskId = await createTask(student);
  const bytes = Buffer.from("SYNTHETIC-STUDENT-RECORD\n合成学籍证明，仅供测试。");
  const uploaded = await student.api.post(`/api/tasks/${taskId}/materials`, {
    multipart: { files: { name: "student-record.txt", mimeType: "text/plain", buffer: bytes } },
  });
  expect(uploaded.status()).toBe(201);
  const material = (await uploaded.json()).materials[0];
  const path = `/api/tasks/${taskId}/materials/${material.id}/versions/1?file=1`;
  const original = await student.api.get(path);
  expect(original.status()).toBe(200);
  expect(await original.body()).toEqual(bytes);
  expect(original.headers()["x-content-type-options"]).toBe("nosniff");
  expect(original.headers()["cache-control"]).toContain("no-store");
  for (const actor of [peer, admin]) {
    expect((await actor.api.get(path)).status()).toBe(404);
    expect((await actor.api.get(path, { headers: { Range: "bytes=0-8" } })).status()).toBe(404);
  }
  expect(
    (
      await student.api.patch(`/api/tasks/${taskId}/access`, {
        data: { username: peer.username, enabled: true },
      })
    ).status(),
  ).toBe(200);
  const partial = await peer.api.get(path, { headers: { Range: "bytes=0-8" } });
  expect(partial.status()).toBe(206);
  expect(await partial.body()).toEqual(bytes.subarray(0, 9));
  expect(partial.headers()["content-range"]).toBe(`bytes 0-8/${bytes.length}`);
  const suffix = await peer.api.get(path, { headers: { Range: "bytes=-4" } });
  expect(suffix.status()).toBe(206);
  expect(await suffix.body()).toEqual(bytes.subarray(-4));
  expect((await peer.api.get(path, { headers: { Range: "bytes=99999-" } })).status()).toBe(416);
  expect(
    (
      await student.api.patch(`/api/tasks/${taskId}/access`, {
        data: { username: peer.username, enabled: false },
      })
    ).status(),
  ).toBe(200);
  expect((await peer.api.get(path, { headers: { Range: "bytes=0-8" } })).status()).toBe(404);
});

test("公告分页保留筛选条件，第二页不重复且越界页码回到最后有效页", async ({ page, actors }) => {
  const quotaDb = database();
  quotaDb.prepare("DELETE FROM rate_limits WHERE key=?").run(`writes:${actors.admin.id}`);
  quotaDb.close();
  const marker = unique("分页回归");
  const ids: string[] = [];
  for (let index = 0; index < 21; index++) {
    const item = await draft(
      actors.admin,
      noticeContent({
        title: `${marker}-${index}`,
        category: "ncre",
        region: "广东",
        stage: "考试",
        year: 2028,
      }),
    );
    await publish(actors.admin, item.id);
    ids.push(item.id);
  }
  await page.context().addCookies((await actors.student.api.storageState()).cookies);
  const query = new URLSearchParams({
    q: marker,
    category: "ncre",
    region: "广东",
    year: "2028",
    stage: "考试",
  });
  await page.goto(`/exams?${query}`);
  await expect(page.locator("article")).toHaveCount(20);
  const firstPage = await page
    .locator("article h2 a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  await page.getByRole("link", { name: "下一页", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(1);
  const actual = new URL(page.url());
  for (const [key, value] of query) expect(actual.searchParams.get(key)).toBe(value);
  expect(actual.searchParams.get("page")).toBe("2");
  const last = await page.locator("article h2 a").getAttribute("href");
  expect(firstPage).not.toContain(last);
  expect(
    new Set([...firstPage, last].map((href) => new URL(href!, "http://local").pathname)),
  ).toEqual(new Set(ids.map((id) => `/exams/${id}`)));
  await expect(page.getByRole("link", { name: "下一页", exact: true })).toHaveCount(0);
  query.set("page", "999");
  await page.goto(`/exams?${query}`);
  await expect(page.getByRole("navigation", { name: "公告分页" })).toContainText("第2页");
  await expect(page.locator("article")).toHaveCount(1);
});
