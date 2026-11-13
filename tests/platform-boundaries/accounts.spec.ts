import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  test,
  expect,
  createActor,
  createTask,
  database,
  loginAgain,
  password,
  unique,
} from "../helpers/platform-boundaries";

for (const [name, username] of [
  ["用户名不足3位", "ab"],
  ["用户名数字开头", "1student"],
  ["用户名包含中文", "学生账号"],
  ["用户名超过32位", "a".repeat(33)],
]) {
  test(`注册拒绝${name}`, async ({ request }) => {
    const response = await request.post("/api/auth/register", { data: { username, password } });
    expect(response.status()).toBe(400);
    expect((await request.get("/api/auth/me")).status()).toBe(401);
  });
}
for (const [name, value] of [
  ["不足12位", "Mixed-12345"],
  ["超过128位", "Ab1!".repeat(33)],
  ["单一重复字符", "x".repeat(12)],
  ["常见弱密码", "PASSWORD123456"],
]) {
  test(`注册拒绝密码${name}`, async ({ request }) => {
    expect(
      (
        await request.post("/api/auth/register", {
          data: { username: unique("invalid"), password: value },
        })
      ).status(),
    ).toBe(400);
  });
}

test("注册拒绝客户端指定管理员身份", async ({ request }) => {
  const username = unique("injected");
  expect(
    (
      await request.post("/api/auth/register", { data: { username, password, role: "admin" } })
    ).status(),
  ).toBe(400);
  const db = database();
  try {
    expect(db.prepare("SELECT 1 FROM accounts WHERE username=?").get(username)).toBeUndefined();
  } finally {
    db.close();
  }
});

test("账号接口拒绝损坏JSON和超限正文，服务仍可用", async ({ request }) => {
  expect(
    (
      await request.post("/api/auth/register", {
        data: '{"username":',
        headers: { "Content-Type": "application/json" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/auth/register", {
        data: JSON.stringify({ nickname: "x".repeat(32768) }),
        headers: { "Content-Type": "application/json" },
      })
    ).status(),
  ).toBe(413);
  expect((await request.get("/api/health")).status()).toBe(200);
});

test("12位密码和32位用户名可以注册，但注册本身不创建登录会话", async ({ request }) => {
  const username = unique("boundary").padEnd(32, "x");
  const response = await request.post("/api/auth/register", {
    data: { username: ` ${username.toUpperCase()} `, password: "Mixed-12345!" },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.account.username).toBe(username);
  expect(new Set(body.recoveryCodes).size).toBe(8);
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect((await request.get("/api/auth/me")).status()).toBe(401);
  expect(
    (
      await request.post("/api/auth/login", {
        data: { username: username.toUpperCase(), password: "Mixed-12345!" },
      })
    ).status(),
  ).toBe(200);
  const me = await request.get("/api/auth/me");
  expect(me.headers()["cache-control"]).toContain("no-store");
  expect(Object.keys((await me.json()).account).sort()).toEqual([
    "id",
    "nickname",
    "role",
    "username",
  ]);
});

test("同名并发注册只产生一个账号和一组恢复码", async ({ request }) => {
  const username = unique("concurrent");
  const responses = await Promise.all([
    request.post("/api/auth/register", { data: { username, password } }),
    request.post("/api/auth/register", { data: { username: username.toUpperCase(), password } }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
  const db = database();
  try {
    expect(db.prepare("SELECT COUNT(*) n FROM accounts WHERE username=?").get(username)).toEqual({
      n: 1,
    });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM recovery_codes WHERE user_id=(SELECT id FROM accounts WHERE username=?)",
        )
        .get(username),
    ).toEqual({ n: 8 });
  } finally {
    db.close();
  }
});

test("退出当前设备仅撤销当前会话，复制的旧Cookie不能继续使用", async ({ playwright }) => {
  const actor = await createActor(playwright, "logout");
  const second = await loginAgain(playwright, actor);
  const copied = await actor.api.storageState();
  const replay = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3132",
    storageState: copied,
  });
  try {
    expect((await actor.api.post("/api/auth/logout")).status()).toBe(200);
    expect((await actor.api.get("/api/auth/me")).status()).toBe(401);
    expect((await replay.get("/api/auth/me")).status()).toBe(401);
    expect((await second.get("/api/auth/me")).status()).toBe(200);
  } finally {
    await Promise.all([actor.api.dispose(), second.dispose(), replay.dispose()]);
  }
});

test("退出全部设备同时撤销两个会话，其他账号保持可用", async ({ playwright, actors }) => {
  const actor = await createActor(playwright, "logoutall");
  const second = await loginAgain(playwright, actor);
  try {
    expect((await actor.api.post("/api/auth/logout-all", { data: {} })).status()).toBe(200);
    expect((await actor.api.get("/api/auth/me")).status()).toBe(401);
    expect((await second.get("/api/auth/me")).status()).toBe(401);
    expect((await actors.peer.api.get("/api/auth/me")).status()).toBe(200);
  } finally {
    await Promise.all([actor.api.dispose(), second.dispose()]);
  }
});

test("错误旧密码不能改密，正确改密撤销所有设备并轮换恢复码", async ({ playwright }) => {
  const actor = await createActor(playwright, "password");
  const second = await loginAgain(playwright, actor);
  try {
    expect(
      (
        await actor.api.post("/api/auth/password", {
          data: { currentPassword: "Wrong-password!", password: password + "new" },
        })
      ).status(),
    ).toBe(400);
    expect((await second.get("/api/auth/me")).status()).toBe(200);
    const changed = await actor.api.post("/api/auth/password", {
      data: { currentPassword: password, password: password + "new" },
    });
    expect(changed.status()).toBe(200);
    expect((await changed.json()).recoveryCodes).toHaveLength(8);
    expect((await second.get("/api/auth/me")).status()).toBe(401);
    expect((await actor.api.get("/api/auth/me")).status()).toBe(401);
    expect(
      (
        await actor.api.post("/api/auth/login", { data: { username: actor.username, password } })
      ).status(),
    ).toBe(401);
    expect(
      (
        await actor.api.post("/api/auth/recover", {
          data: { username: actor.username, password, recoveryCode: actor.recoveryCodes[0] },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await actor.api.post("/api/auth/login", {
          data: { username: actor.username, password: password + "new" },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await Promise.all([actor.api.dispose(), second.dispose()]);
  }
});

test("同一恢复码并发使用仅成功一次，旧恢复码和全部旧会话同时失效", async ({ playwright }) => {
  const actor = await createActor(playwright, "recover");
  const second = await loginAgain(playwright, actor);
  try {
    const responses = await Promise.all(
      [actor.api, second].map((api) =>
        api.post("/api/auth/recover", {
          data: {
            username: actor.username,
            recoveryCode: actor.recoveryCodes[0],
            password: password + "reset",
          },
        }),
      ),
    );
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 400]);
    expect((await actor.api.get("/api/auth/me")).status()).toBe(401);
    expect((await second.get("/api/auth/me")).status()).toBe(401);
    expect(
      (
        await second.post("/api/auth/recover", {
          data: {
            username: actor.username,
            recoveryCode: actor.recoveryCodes[1],
            password,
          },
        })
      ).status(),
    ).toBe(400);
    const winner = responses.find((response) => response.status() === 200)!;
    expect(
      (await winner.json()).recoveryCodes.some((code: string) =>
        actor.recoveryCodes.includes(code),
      ),
    ).toBe(false);
    expect(
      (
        await actor.api.post("/api/auth/login", {
          data: { username: actor.username, password: password + "reset" },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await Promise.all([actor.api.dispose(), second.dispose()]);
  }
});

test("账号限频按规范用户名共享，窗口过期可重试且不影响其他账号", async ({ request, actors }) => {
  const username = unique("limited");
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await request.post("/api/auth/login", { data: { username, password } })).status()).toBe(
      401,
    );
  }
  expect(
    (
      await request.post("/api/auth/login", {
        data: { username: ` ${username.toUpperCase()} `, password },
      })
    ).status(),
  ).toBe(429);
  expect((await actors.peer.api.get("/api/auth/me")).status()).toBe(200);
  const db = database();
  try {
    expect(
      db.prepare("SELECT count FROM rate_limits WHERE key=?").get(`auth:login:${username}`),
    ).toEqual({ count: 10 });
    db.prepare("UPDATE rate_limits SET reset_at=0 WHERE key=?").run(`auth:login:${username}`);
  } finally {
    db.close();
  }
  expect((await request.post("/api/auth/login", { data: { username, password } })).status()).toBe(
    401,
  );
});

test("伪造会话值或泄露的数据库摘要均不能作为Cookie登录", async ({ playwright, actors }) => {
  const db = database();
  let digest: string;
  try {
    digest = (
      db.prepare("SELECT digest FROM sessions WHERE user_id=?").get(actors.student.id) as {
        digest: string;
      }
    ).digest;
  } finally {
    db.close();
  }
  for (const token of ["invalid", "a".repeat(64), digest]) {
    const api = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:3132",
      extraHTTPHeaders: { Cookie: `exam_session=${token}` },
    });
    try {
      expect((await api.get("/api/auth/me")).status()).toBe(401);
      expect((await api.get("/api/tasks")).status()).toBe(401);
    } finally {
      await api.dispose();
    }
  }
});

test("超过20个会话时淘汰最旧设备，最新登录有效", async ({ playwright }) => {
  const actor = await createActor(playwright, "sessioncap");
  const tokens = Array.from({ length: 20 }, () => randomBytes(32).toString("hex"));
  const db = database();
  try {
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(actor.id);
    const insert = db.prepare("INSERT INTO sessions VALUES (?,?,?,?)");
    tokens.forEach((token, index) =>
      insert.run(
        createHash("sha256").update(token).digest("hex"),
        actor.id,
        Date.now() + 60000,
        Date.now() - 60000 + index,
      ),
    );
    expect(
      (
        await actor.api.post("/api/auth/login", { data: { username: actor.username, password } })
      ).status(),
    ).toBe(200);
    expect(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(actor.id)).toEqual({
      n: 20,
    });
    expect(
      db
        .prepare("SELECT 1 FROM sessions WHERE digest=?")
        .get(createHash("sha256").update(tokens[0]!).digest("hex")),
    ).toBeUndefined();
    expect((await actor.api.get("/api/auth/me")).status()).toBe(200);
  } finally {
    db.close();
    await actor.api.dispose();
  }
});

test("匿名不能读取任务、文件、证据、报告、打包和管理入口", async ({ request }) => {
  const taskId = randomUUID();
  for (const path of [
    "/api/tasks",
    `/api/tasks/${taskId}`,
    `/api/tasks/${taskId}/materials/${randomUUID()}/versions/1`,
    `/api/tasks/${taskId}/checks/${randomUUID()}/source`,
    `/api/tasks/${taskId}/report`,
    `/api/tasks/${taskId}/package`,
    "/api/admin/exams",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect(response.headers()["cache-control"], path).toContain("no-store");
  }
});

test("跨站写入被拒绝，合法同站写入可以更新昵称", async ({ actors }) => {
  const api = actors.student.api;
  expect(
    (
      await api.post("/api/auth/profile", {
        data: { nickname: "不应保存" },
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  const response = await api.post("/api/auth/profile", {
    data: { nickname: "  合成学生  " },
    headers: { Origin: "http://127.0.0.1:3132" },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).account.nickname).toBe("合成学生");
  expect(
    (
      await api.post("/api/auth/profile", {
        data: { nickname: "冒用", userId: actors.peer.id },
      })
    ).status(),
  ).toBe(400);
});

test("被授权者可以读取任务但不能查看或转授权限，撤销后全部入口恢复隔离", async ({ actors }) => {
  const { student, peer, admin } = actors;
  const taskId = await createTask(student);
  const path = `/api/tasks/${taskId}/access`;
  for (const data of [
    { username: student.username, enabled: true },
    { username: unique("missing"), enabled: true },
    { userId: peer.id, enabled: true },
  ])
    expect((await student.api.patch(path, { data })).status()).toBe(400);
  expect(
    (await student.api.patch(path, { data: { username: peer.username, enabled: true } })).status(),
  ).toBe(200);
  expect((await peer.api.get(`/api/tasks/${taskId}`)).status()).toBe(200);
  expect((await peer.api.get(path)).status()).toBe(403);
  expect(
    (await peer.api.patch(path, { data: { username: admin.username, enabled: true } })).status(),
  ).toBe(403);
  const grants = await (await student.api.get(path)).json();
  expect(grants.users).toEqual([peer.id]);
  expect(JSON.stringify(grants)).not.toContain(admin.username);
  expect(
    (await student.api.patch(path, { data: { userId: peer.id, enabled: false } })).status(),
  ).toBe(200);
  for (const suffix of ["", "/report", "/package", "/access"])
    expect((await peer.api.get(`/api/tasks/${taskId}${suffix}`)).status()).toBe(404);
});

test("注销只删除本人任务和授权，同用户名重新注册不能继承共享任务", async ({
  playwright,
  actors,
}) => {
  const departing = await createActor(playwright, "departing");
  try {
    const owned = await createTask(departing);
    const shared = await createTask(actors.student);
    expect(
      (
        await actors.student.api.patch(`/api/tasks/${shared}/access`, {
          data: { username: departing.username, enabled: true },
        })
      ).status(),
    ).toBe(200);
    const manifest = await (await departing.api.get("/api/auth/delete")).json();
    expect(manifest.deletionSummary.tasks.map((item: { id: string }) => item.id)).toEqual([owned]);
    expect(
      (
        await departing.api.post("/api/auth/delete", {
          data: { password: "Wrong-password!", confirmation: "注销并删除我的任务" },
        })
      ).status(),
    ).toBe(400);
    expect((await departing.api.get(`/api/tasks/${owned}`)).status()).toBe(200);
    expect(
      (
        await departing.api.post("/api/auth/delete", {
          data: { password, confirmation: "注销并删除我的任务" },
        })
      ).status(),
    ).toBe(200);
    expect((await actors.student.api.get(`/api/tasks/${shared}`)).status()).toBe(200);
    const registration = await departing.api.post("/api/auth/register", {
      data: { username: departing.username, password },
    });
    expect(registration.status()).toBe(201);
    expect((await registration.json()).account.id).not.toBe(departing.id);
    await departing.api.post("/api/auth/login", {
      data: { username: departing.username, password },
    });
    expect((await departing.api.get(`/api/tasks/${shared}`)).status()).toBe(404);
    expect((await departing.api.get(`/api/tasks/${owned}`)).status()).toBe(404);
    expect(
      (await (await actors.student.api.get(`/api/tasks/${shared}/access`)).json()).grants,
    ).not.toContain(departing.id);
  } finally {
    await departing.api.dispose();
  }
});
