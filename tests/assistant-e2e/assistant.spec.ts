import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Database from "better-sqlite3";

test("受控模型：偏好门禁、原文引用、成功失败耗用和未知Token分别记录", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3145" });
  const username = `assistant_${Date.now()}`,
    password = "Assistant-regression-2026!";
  const registration = await api.post("/api/auth/register", { data: { username, password } });
  expect(registration.status()).toBe(201);
  const account = (await registration.json()).account;
  expect((await api.post("/api/auth/login", { data: { username, password } })).ok()).toBeTruthy();
  const db = new Database(resolve(".local-data/assistant-e2e/platform.sqlite"));
  const id = randomUUID();
  const content = {
    title: `2040年注会合成来源-${id}`,
    category: "cpa",
    region: "全国",
    edition: "2040年合成考期",
    kind: "knowledge",
    author: "合成测试",
    url: "https://www.cicpa.org.cn/",
    text: "合成申请条件：提交本人学籍材料。仅用于测试，不是真实政策。",
    checkedAt: "2026-11-14",
    scope: "全国合成测试",
    disposition: "现行",
  };
  try {
    db.prepare(
      "INSERT INTO portal_content(id,kind,status,version,published_version,updated_at) VALUES (?,'knowledge','published',1,1,?)",
    ).run(id, new Date().toISOString());
    db.prepare(
      "INSERT INTO portal_content_versions(content_id,version,payload,actor,created_at) VALUES (?,1,?,'synthetic-test',?)",
    ).run(id, JSON.stringify(content), new Date().toISOString());
    // Avoid prior runs' public fixtures influencing scope or evidence order.
    db.prepare("UPDATE portal_content SET status='withdrawn' WHERE kind='knowledge' AND id<>?").run(
      id,
    );
    const question = "2040年注会合成申请条件";
    const blocked = await api.post("/api/assistant", {
      data: { requestId: randomUUID(), question, allowExternal: false },
    });
    expect(blocked.status()).toBe(200);
    expect(await blocked.json()).toMatchObject({ mode: "retrieval", usage: { modelCall: null } });
    expect((await (await api.get("/api/assistant")).json()).usage.modelRequests).toBe(0);
    const requestId = randomUUID();
    const input = { requestId, question };
    const response = await api.post("/api/assistant", { data: input });
    expect(response.status(), await response.text()).toBe(200);
    const answer = await response.json();
    expect(answer.mode).toBe("live");
    expect(answer.citations[0]).toMatchObject({ id, version: 1, quote: content.text });
    expect(answer.usage.modelCall).toMatchObject({
      status: "completed",
      inputTokens: 100,
      outputTokens: 30,
      requestCount: 1,
    });
    expect(answer.usage.cost).toBeNull();
    expect(await (await api.post("/api/assistant", { data: input })).json()).toEqual(answer);
    expect((await (await api.get("/api/assistant")).json()).usage.modelRequests).toBe(1);
    const invalid = await api.post("/api/assistant", {
      data: { requestId: randomUUID(), question: question + " INVALID_QUOTE", allowExternal: true },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toContain("引用无法核验");
    const failed = await api.post("/api/assistant", {
      data: { requestId: randomUUID(), question: question + " FAIL_MODEL", allowExternal: true },
    });
    expect(failed.status()).toBeGreaterThanOrEqual(400);
    const unknown = await api.post("/api/assistant", {
      data: { requestId: randomUUID(), question: question + " UNKNOWN_USAGE", allowExternal: true },
    });
    expect(unknown.status(), await unknown.text()).toBe(200);
    const unknownAnswer = await unknown.json();
    expect(unknownAnswer.usage.modelCall.inputTokens).toBeNull();
    const usage = (await (await api.get("/api/assistant")).json()).usage;
    expect(usage).toMatchObject({
      questions: 5,
      failed: 2,
      inputTokens: 200,
      outputTokens: 60,
      cost: null,
    });
    expect(usage.modelRequests).toBeGreaterThanOrEqual(4);
    expect(usage.unknownTokenCalls).toBeGreaterThanOrEqual(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM assistant_requests WHERE user_id=? AND status='failed'",
        )
        .get(account.id),
    ).toMatchObject({ count: 2 });
    const beforeStructure = (await (await api.get("/api/assistant")).json()).usage.modelRequests;
    const malformed = await api.post("/api/assistant", {
      data: {
        requestId: randomUUID(),
        question: question + " INVALID_STRUCTURE",
        allowExternal: true,
      },
    });
    expect(malformed.status()).toBe(502);
    expect((await malformed.json()).code).toBe("invalid_response");
    const afterStructure = (await (await api.get("/api/assistant")).json()).usage.modelRequests;
    expect(afterStructure - beforeStructure).toBe(1);
    expect(
      (
        await api.post("/api/learning", {
          data: {
            action: "preferences",
            personalized: true,
            retainChat: false,
            externalEnabled: false,
          },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await api.post("/api/learning", {
          data: { action: "preferences", personalized: false, retainChat: false },
        })
      ).ok(),
    ).toBeTruthy();
    const privateAnswer = await api.post("/api/assistant", {
      data: { requestId: randomUUID(), question, allowExternal: true },
    });
    expect(privateAnswer.status()).toBe(200);
    expect(await privateAnswer.json()).toMatchObject({
      mode: "retrieval",
      usage: { modelCall: null },
    });
    expect((await (await api.get("/api/assistant")).json()).usage.modelRequests).toBe(
      afterStructure,
    );
  } finally {
    db.close();
    await api.dispose();
  }
});
