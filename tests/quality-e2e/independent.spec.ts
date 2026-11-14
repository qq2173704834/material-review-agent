import { test, expect } from "@playwright/test";
import { z } from "zod";
import { modelCallSchema } from "../../src/domain/model-call";
const answerSchema = z.object({
  answer: z.string(),
  kind: z.string(),
  mode: z.string(),
  citations: z.array(z.object({ id: z.string(), quote: z.string() })),
  conversationId: z.string().nullable(),
  usage: z.object({ modelCall: modelCallSchema.nullable() }).optional(),
});
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import cases from "../fixtures/assistant-quality-v2.json" with { type: "json" };

test("ENG-066 固定样例真实质量复核：最多五题、有界尝试、含独立Python对照及隔离", async ({
  request,
  playwright,
}) => {
  const oracle = execFileSync(
    "python",
    [
      "-c",
      'import json,sys\nt=([1,2],3)\nt[0].append(4)\ntry:\n hash(t)\n error=None\nexcept TypeError as exc:\n error=type(exc).__name__\nprint(json.dumps({"version":sys.version.split()[0],"tuple":repr(t),"hashError":error,"hashableTuple":hash((1,2,3)) is not None}))',
    ],
    { encoding: "utf8" },
  );
  const reference = JSON.parse(oracle);
  expect(reference).toMatchObject({
    tuple: "([1, 2, 4], 3)",
    hashError: "TypeError",
    hashableTuple: true,
  });
  const username = `quality_v2_${randomUUID().slice(0, 8)}`,
    password = `Quality-v2-${randomUUID()}!`;
  expect(
    (await request.post("/api/auth/register", { data: { username, password } })).status(),
  ).toBe(201);
  expect((await request.post("/api/auth/login", { data: { username, password } })).status()).toBe(
    200,
  );
  const maxAttempts = Number(process.env.REVIEW_QUALITY_MAX_ATTEMPTS ?? 1);
  if (![1, 2].includes(maxAttempts)) throw new Error("只允许1—2次有界尝试");
  const selectedIds = process.env.REVIEW_QUALITY_CASES?.split(",");
  const selectedCases = selectedIds
    ? cases.cases.filter((c) => selectedIds.includes(c.id))
    : cases.cases;
  if (!selectedCases.length || (selectedIds && selectedCases.length !== selectedIds.length))
    throw new Error("只允许预登记样例ID");
  const results: Array<{
    sample: (typeof cases.cases)[number];
    start: string;
    status: number;
    payload: unknown;
    review: string;
  }> = [];
  const persist = (): void => {
    mkdirSync("work", { recursive: true });
    writeFileSync(
      "work/assistant-quality-v2.json",
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          maximumModelRequests: selectedCases.length * maxAttempts,
          maxAttempts,
          reference,
          blockingCriteria: cases.blockingCriteria,
          results,
        },
        null,
        2,
      ),
    );
  };
  for (const sample of selectedCases) {
    const response = await request.post("/api/assistant", {
      data: {
        requestId: randomUUID(),
        question: sample.question,
        learning: sample.learning,
        allowExternal: true,
      },
      timeout: 65000,
    });
    const rawPayload: unknown = await response.json();
    results.push({
      sample,
      start: new Date().toISOString(),
      status: response.status(),
      payload: rawPayload,
      review: "待按预登记依据复核，API成功不等于语义正确",
    });
    persist();
    if (!response.ok()) break;
    const payload = answerSchema.parse(rawPayload);
    expect(payload.kind).toBe(
      sample.id === "dele-unknown-date" ? "需补充信息" : sample.learning ? "学习建议" : "考试信息",
    );
    if (!sample.learning && sample.id !== "dele-unknown-date")
      expect(payload.citations.length).toBeGreaterThan(0);
    if (payload.usage?.modelCall)
      expect(payload.usage.modelCall.requestCount).toBeLessThanOrEqual(maxAttempts);
  }
  expect(results).toHaveLength(selectedCases.length);
  for (const result of results) {
    expect(result.status).toBe(200);
    const answer = answerSchema.parse(result.payload);
    expect(answer.mode).toBe(result.sample.id === "dele-unknown-date" ? "retrieval" : "live");
    if (result.sample.id === "dele-unknown-date") {
      expect(answer.usage?.modelCall).toBeNull();
      expect(answer.answer).toContain("无法确认");
    }
  }
  const firstAnswer = answerSchema.parse(results.at(0)?.payload);
  const peer = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3147" });
  try {
    const peerName = `quality_peer_${randomUUID().slice(0, 8)}`;
    expect(
      (await peer.post("/api/auth/register", { data: { username: peerName, password } })).status(),
    ).toBe(201);
    expect(
      (await peer.post("/api/auth/login", { data: { username: peerName, password } })).status(),
    ).toBe(200);
    const crossStatus = (
      await peer.get(`/api/assistant?conversation=${firstAnswer.conversationId}`)
    ).status();
    expect(crossStatus).toBe(404);
    writeFileSync(
      "work/assistant-quality-v2-isolation.json",
      JSON.stringify(
        {
          crossStatus,
          modelRequests: (await (await peer.get("/api/assistant")).json()).usage.modelRequests,
        },
        null,
        2,
      ),
    );
  } finally {
    await peer.dispose();
  }
});
