import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const password = "StudentAccount-test-2026!";
test("真实账号门禁、恢复、隔离、发布收藏和公告预审版本闭环", async ({
  browser,
  playwright,
  page,
}) => {
  const suffix = Date.now().toString(36);
  const alice = `alice_${suffix}`;
  const bob = `bob_${suffix}`;
  const admin = `admin_${suffix}`;
  const a = await playwright.request.newContext();
  const b = await playwright.request.newContext();
  const manager = await playwright.request.newContext();
  expect((await a.get("/api/tasks")).status()).toBe(401);
  await page.goto("/exams");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
  const injected = await a.post("/api/auth/register", {
    data: { username: `bad_${suffix}`, password, role: "admin" },
  });
  expect(injected.status()).toBe(400);
  const registration = await a.post("/api/auth/register", { data: { username: alice, password } });
  expect(registration.status()).toBe(201);
  const registered = await registration.json();
  expect(registered.recoveryCodes).toHaveLength(8);
  expect(registered.account.role).toBe("user");
  expect(
    (
      await a.post("/api/auth/register", { data: { username: alice.toUpperCase(), password } })
    ).status(),
  ).toBe(409);
  expect(
    (await b.post("/api/auth/register", { data: { username: bob, password } })).ok(),
  ).toBeTruthy();
  expect(
    (await manager.post("/api/auth/register", { data: { username: admin, password } })).ok(),
  ).toBeTruthy();
  for (const [context, username] of [
    [a, alice],
    [b, bob],
    [manager, admin],
  ] as const)
    expect(
      (await context.post("/api/auth/login", { data: { username, password } })).ok(),
    ).toBeTruthy();
  expect((await a.get("/api/admin/exams")).status()).toBe(403);
  execFileSync(process.execPath, [
    "scripts/platform-admin.mjs",
    "role",
    "--username",
    admin,
    "--role",
    "admin",
    "--apply",
    "--data-dir",
    ".local-data/platform-e2e",
  ]);
  expect((await manager.get("/api/admin/exams")).status()).toBe(401);
  await manager.post("/api/auth/login", { data: { username: admin, password } });
  const created = await a.post("/api/tasks", {
    data: {
      name: "私有任务",
      description: "合成隐私材料",
      noticeText: "报名须提交身份证复印件。",
      background: { projectType: "报考", projectStage: "报名", collaborationScope: "individual" },
    },
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()).task;
  expect((await b.get(`/api/tasks/${task.id}`)).status()).toBe(404);
  expect((await manager.get(`/api/tasks/${task.id}`)).status()).toBe(404);
  expect(
    (
      await a.patch(`/api/tasks/${task.id}/access`, { data: { username: bob, enabled: true } })
    ).ok(),
  ).toBeTruthy();
  expect((await b.get(`/api/tasks/${task.id}`)).ok()).toBeTruthy();
  await a.patch(`/api/tasks/${task.id}/access`, { data: { username: bob, enabled: false } });
  expect((await b.get(`/api/tasks/${task.id}`)).status()).toBe(404);
  const data = await (await manager.get("/api/admin/exams")).json();
  const source = data.sources.find((s: { category: string }) => s.category === "cet4");
  const content = {
    title: `合成四级公告-${suffix}`,
    category: "cet4",
    region: "全国",
    edition: "2027年上半年（合成测试）",
    year: 2027,
    stage: "招考报名",
    organizer: "合成测试组织方",
    publishedAt: "2027-03-01",
    text: "合成测试：报名从2027年3月1日开始，2027年3月20日截止。报名须提交学籍证明。",
    summary: "仅供合成测试",
    audience: "合成学生",
    timeline: [
      { label: "报名开始", value: "2027-03-01", quote: "报名从2027年3月1日开始" },
      { label: "报名截止", value: "2027-03-20", quote: "2027年3月20日截止" },
    ],
    attachments: [],
    disposition: "正常",
  };
  const draft = await manager.post("/api/admin/exams", {
    data: {
      action: "draft",
      sourceId: source.id,
      url: `https://cet.neea.edu.cn/synthetic-${suffix}`,
      content,
    },
  });
  expect(draft.ok()).toBeTruthy();
  const id = (await draft.json()).id;
  expect((await a.get(`/exams/${id}`)).status()).toBe(404);
  expect(
    (await manager.post("/api/admin/exams", { data: { action: "publish", id, version: 1 } })).ok(),
  ).toBeTruthy();
  expect((await a.get(`/exams/${id}`)).status()).toBe(200);
  const dupe = await manager.post("/api/admin/exams", {
    data: {
      action: "draft",
      sourceId: source.id,
      url: `https://cet.neea.edu.cn/synthetic-${suffix}`,
      content,
    },
  });
  expect((await dupe.json()).changed).toBe(false);
  const bad = await manager.post("/api/admin/exams", {
    data: { action: "draft", sourceId: source.id, url: "http://127.0.0.1/private", content },
  });
  expect(bad.status()).toBe(400);
  expect((await a.post(`/api/exams/${id}`, { data: { action: "favorite" } })).ok()).toBeTruthy();
  expect(await (await a.get("/me")).text()).toContain(content.title);
  expect(await (await b.get("/me")).text()).not.toContain(content.title);
  const linked = await a.post(`/api/exams/${id}`, {
    data: { action: "task", stage: "报名", target: "待确认" },
  });
  expect(linked.status()).toBe(201);
  const linkedId = (await linked.json()).taskId;
  const repeated = await a.post(`/api/exams/${id}`, {
    data: { action: "task", stage: "报名", target: "待确认" },
  });
  expect((await repeated.json()).taskId).toBe(linkedId);
  await manager.post("/api/admin/exams", {
    data: {
      action: "draft",
      sourceId: source.id,
      url: `https://cet.neea.edu.cn/synthetic-${suffix}`,
      content: { ...content, text: content.text + "更正：需补充成绩单。" },
    },
  });
  await manager.post("/api/admin/exams", { data: { action: "publish", id, version: 2 } });
  expect((await (await a.get("/me")).text()).replace(/<!--.*?-->/g, "")).toContain("来源已有v2");
  expect(
    (
      await manager.post("/api/admin/exams", { data: { action: "publish", id, version: 1 } })
    ).status(),
  ).toBe(400);
  const before = await (await a.get(`/api/tasks/${linkedId}`)).text();
  expect(before).not.toContain("需补充成绩单");
  expect(
    (await b.post(`/api/exams/${id}`, { data: { action: "adopt", taskId: linkedId } })).status(),
  ).toBe(400);
  expect(
    (await a.post(`/api/exams/${id}`, { data: { action: "adopt", taskId: linkedId } })).ok(),
  ).toBeTruthy();
  const sourcesResponse = await a.get(`/api/tasks/${linkedId}`);
  expect(await sourcesResponse.text()).toContain("需补充成绩单");
  await manager.post("/api/admin/exams", { data: { action: "withdraw", id, version: 2 } });
  expect((await a.get(`/exams/${id}`)).status()).toBe(404);
  expect(await (await a.get("/me")).text()).toContain("公告已撤回");
  const cookie = (await a.storageState()).cookies.find((c) => c.name === "exam_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  const recovered = await a.post("/api/auth/recover", {
    data: {
      username: alice,
      password: password + "new",
      recoveryCode: registered.recoveryCodes[0],
    },
  });
  expect(recovered.ok()).toBeTruthy();
  expect((await a.get("/api/tasks")).status()).toBe(401);
  expect(
    (
      await a.post("/api/auth/recover", {
        data: {
          username: alice,
          password: password + "bad",
          recoveryCode: registered.recoveryCodes[0],
        },
      })
    ).status(),
  ).toBe(400);
  expect((await a.post("/api/auth/login", { data: { username: alice, password } })).status()).toBe(
    401,
  );
  expect(
    (
      await a.post("/api/auth/login", { data: { username: alice, password: password + "new" } })
    ).ok(),
  ).toBeTruthy();
  const sql = new Database(resolve(".local-data/platform-e2e/platform.sqlite"));
  const row = sql.prepare("SELECT password_hash FROM accounts WHERE username=?").get(alice) as {
    password_hash: string;
  };
  expect(row.password_hash).toMatch(/^scrypt-v1\$/);
  expect(JSON.stringify(sql.prepare("SELECT * FROM sessions").all())).not.toContain(cookie?.value);
  sql.close();
  await a.post("/api/auth/logout", { data: {} });
  expect((await a.get("/api/tasks")).status()).toBe(401);
  const context = await browser.newContext();
  const loginPage = await context.newPage();
  await loginPage.goto("/login?next=//evil.example");
  await loginPage.getByRole("textbox", { name: /^用户名/ }).fill(bob);
  await loginPage.getByLabel("密码", { exact: true }).fill(password);
  await loginPage.getByRole("button", { name: "登录", exact: true }).click();
  await expect(loginPage).toHaveURL(/\/exams$/);
  await context.close();
  await a.dispose();
  await b.dispose();
  await manager.dispose();
});

test("账号设置、会话期限、禁用与迁移预演及数据库备份恢复", async ({ playwright }) => {
  const username = `migrate_${Date.now().toString(36)}`;
  const a = await playwright.request.newContext();
  const registration = await a.post("/api/auth/register", { data: { username, password } });
  expect(registration.status()).toBe(201);
  const account = (await registration.json()).account;
  await a.post("/api/auth/login", { data: { username, password } });
  const taskResponse = await a.post("/api/tasks", {
    data: {
      name: "迁移测试任务",
      description: "合成",
      noticeText: "须提供学生证。",
      background: { projectType: "学生", projectStage: "报名", collaborationScope: "individual" },
    },
  });
  const task = (await taskResponse.json()).task;
  const reviews = new Database(resolve(".local-data/platform-e2e/reviews.sqlite"));
  reviews.prepare("UPDATE review_tasks SET owner_id='synthetic-legacy' WHERE id=?").run(task.id);
  reviews.close();
  expect((await a.get(`/api/tasks/${task.id}`)).status()).toBe(404);
  const command = [
    "scripts/platform-admin.mjs",
    "migrate",
    "--from",
    "synthetic-legacy",
    "--to",
    username,
    "--data-dir",
    ".local-data/platform-e2e",
  ];
  const preview = execFileSync(process.execPath, command, { encoding: "utf8" });
  expect(preview).toContain(task.id);
  expect((await a.get(`/api/tasks/${task.id}`)).status()).toBe(404);
  const output = execFileSync(process.execPath, [...command, "--apply"], { encoding: "utf8" });
  expect(output).toContain("迁移完成");
  expect((await a.get(`/api/tasks/${task.id}`)).status()).toBe(200);
  const backupPath = output.match(/备份：(.*?)。其他/)?.[1];
  expect(backupPath).toBeTruthy();
  const backup = new Database(resolve(backupPath!, "reviews.sqlite"), { readonly: true });
  expect(
    (
      backup.prepare("SELECT owner_id FROM review_tasks WHERE id=?").get(task.id) as {
        owner_id: string;
      }
    ).owner_id,
  ).toBe("synthetic-legacy");
  expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
  const restored = resolve(".local-data/platform-e2e", `restore-${Date.now()}.sqlite`);
  await backup.backup(restored);
  backup.close();
  const restoredDb = new Database(restored, { readonly: true });
  expect(
    (
      restoredDb.prepare("SELECT owner_id FROM review_tasks WHERE id=?").get(task.id) as {
        owner_id: string;
      }
    ).owner_id,
  ).toBe("synthetic-legacy");
  restoredDb.close();
  expect((await a.post("/api/auth/profile", { data: { nickname: "合成学生" } })).ok()).toBeTruthy();
  const upgradeDb = new Database(resolve(".local-data/platform-e2e/platform.sqlite"));
  upgradeDb.pragma("user_version=2");
  upgradeDb.close();
  expect((await a.get("/api/tasks")).status()).toBe(200);
  const futureDb = new Database(resolve(".local-data/platform-e2e/platform.sqlite"));
  expect(futureDb.pragma("user_version", { simple: true })).toBe(3);
  futureDb.pragma("user_version=4");
  futureDb.close();
  expect((await a.get("/api/tasks")).status()).toBe(503);
  const restoreVersionDb = new Database(resolve(".local-data/platform-e2e/platform.sqlite"));
  restoreVersionDb.pragma("user_version=3");
  restoreVersionDb.close();
  expect((await a.get("/api/tasks")).status()).toBe(200);
  execFileSync(process.execPath, [
    "scripts/platform-admin.mjs",
    "disable",
    "--username",
    username,
    "--apply",
    "--data-dir",
    ".local-data/platform-e2e",
  ]);
  expect((await a.get("/api/tasks")).status()).toBe(401);
  expect((await a.post("/api/auth/login", { data: { username, password } })).status()).toBe(401);
  execFileSync(process.execPath, [
    "scripts/platform-admin.mjs",
    "enable",
    "--username",
    username,
    "--apply",
    "--data-dir",
    ".local-data/platform-e2e",
  ]);
  await a.post("/api/auth/login", { data: { username, password } });
  const db = new Database(resolve(".local-data/platform-e2e/platform.sqlite"));
  db.prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?").run(account.id);
  db.close();
  expect((await a.get("/api/tasks")).status()).toBe(401);
  await a.post("/api/auth/login", { data: { username, password } });
  expect(
    (
      await a.post("/api/auth/password", {
        data: { currentPassword: "wrong-password", password: password + "changed" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await a.post("/api/auth/password", {
        data: { currentPassword: password, password: password + "changed" },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await a.get("/api/tasks")).status()).toBe(401);
  await a.post("/api/auth/login", { data: { username, password: password + "changed" } });
  const manifest = await (await a.get("/api/auth/delete")).json();
  expect(manifest.deletionSummary.tasks.some((item: { id: string }) => item.id === task.id)).toBe(
    true,
  );
  const fileResponse = await a.post(`/api/tasks/${task.id}/materials`, {
    multipart: {
      files: { name: "student.txt", mimeType: "text/plain", buffer: Buffer.from("合成学生证材料") },
    },
  });
  expect(fileResponse.ok()).toBeTruthy();
  expect(
    (
      await a.post("/api/auth/delete", {
        data: { password: password + "changed", confirmation: "注销并删除我的任务" },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await a.get("/api/tasks")).status()).toBe(401);
  expect(existsSync(resolve(".local-data/platform-e2e/materials", task.id))).toBe(false);
  const check = new Database(resolve(".local-data/platform-e2e/reviews.sqlite"));
  expect(check.prepare("SELECT 1 FROM review_tasks WHERE id=?").get(task.id)).toBeUndefined();
  check.close();
  await a.dispose();
});

test("手机注册、恢复码保存提示和登录页面可访问性", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const username = `mobile_${Date.now().toString(36)}`;
  await page.goto("/register");
  await page.getByRole("textbox", { name: /^用户名/ }).fill(username);
  await page.getByLabel("昵称", { exact: true }).fill("学生测试");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认新密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("heading", { name: "保存你的账号恢复码" })).toBeVisible();
  await expect(page.locator("pre")).toContainText(/^[a-f0-9]{32}/);
  const codeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载恢复码" }).click();
  expect(await (await codeDownload).failure()).toBeNull();
  await page.getByRole("link", { name: "我已安全保存，前往登录" }).click();
  await page.getByRole("textbox", { name: /^用户名/ }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/exams$/);
  await expect(page.getByRole("heading", { name: "下一场考试，从这里准备" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: "test-results/platform/mobile-exams.png", fullPage: true });
  await page.goto("/account");
  await expect(page.getByText(`当前账号：${username}`, { exact: false })).toBeVisible();
  await context.close();
});

test("服务端调度独立执行，失败退避保留上次成功时间", async () => {
  const db = new Database(resolve(".local-data/platform-e2e/platform.sqlite"));
  const id = `scheduler_${Date.now()}`;
  const previous = "2026-01-01T00:00:00.000Z";
  try {
    db.prepare(
      "INSERT INTO exam_sources(id,name,url,category,region,enabled,interval_hours,last_success,next_run) VALUES (?,?,?,?,?,1,6,?,0)",
    ).run(id, "合成不可用来源", `https://${id}.invalid/`, "graduate", "全国", previous);
    await expect
      .poll(
        () =>
          db.prepare("SELECT failures FROM exam_sources WHERE id=?").get(id) as {
            failures: number;
          },
        { timeout: 75000, intervals: [1000, 3000] },
      )
      .toMatchObject({ failures: 1 });
    const row = db.prepare("SELECT * FROM exam_sources WHERE id=?").get(id) as {
      last_success: string;
      next_run: number;
      error: string;
      locked_until: number;
    };
    expect(row.last_success).toBe(previous);
    expect(row.next_run).toBeGreaterThan(Date.now() + 6 * 3600000);
    expect(row.error).toBeTruthy();
    expect(row.locked_until).toBe(0);
    expect(
      (
        db
          .prepare("SELECT status FROM exam_fetch_runs WHERE source_id=? ORDER BY id DESC LIMIT 1")
          .get(id) as { status: string }
      ).status,
    ).toBe("failed");
  } finally {
    db.prepare("UPDATE exam_sources SET enabled=0 WHERE id=?").run(id);
    db.close();
  }
});
