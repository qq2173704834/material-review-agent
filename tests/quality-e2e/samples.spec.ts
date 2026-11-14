import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const samples = [
  {
    id: "study-python",
    learning: true,
    question:
      "请用一个简单例子解释Python列表与元组的区别，并生成一道练习，标明是AI生成，不是官方真题。",
  },
  {
    id: "study-retrieval",
    learning: true,
    question:
      "请给准备计算机二级Python的在校生一个三天学习计划，区分个人建议与官方考试要求，不保证通过。",
  },
  {
    id: "teacher-proof",
    learning: false,
    question:
      "2026年全国教师资格考试合格证明有效期和教师资格认定是什么关系？省级报名条件还需要核对什么？请只用已审核原文回答。",
  },
];
test("真实模型公开样例：最多三次，不重试，保存引用和耗用供独立复核", async ({ request }) => {
  const username = `quality_${randomUUID().slice(0, 8)}`,
    password = `Quality-${randomUUID()}!`;
  expect(
    (await request.post("/api/auth/register", { data: { username, password } })).status(),
  ).toBe(201);
  expect((await request.post("/api/auth/login", { data: { username, password } })).status()).toBe(
    200,
  );
  const results = [];
  for (const sample of samples) {
    const start = new Date().toISOString();
    const response = await request.post("/api/assistant", {
      data: {
        requestId: randomUUID(),
        question: sample.question,
        learning: sample.learning,
        allowExternal: true,
      },
      timeout: 65000,
    });
    const payload = await response.json();
    results.push({
      sample,
      start,
      status: response.status(),
      payload,
      independentReview: "待独立人工复核，不以API成功计为效果通过",
    });
    // A configuration or provider failure must not generate further paid retries.
    if (!response.ok()) break;
  }
  mkdirSync("work", { recursive: true });
  writeFileSync(
    "work/real-model-quality.json",
    JSON.stringify(
      { checkedAt: new Date().toISOString(), maximumModelRequests: 3, results },
      null,
      2,
    ),
  );
  expect(results).toHaveLength(3);
  for (const result of results) {
    expect(result.status).toBe(200);
    expect(result.payload.mode).toBe("live");
    expect(result.payload.answer.length).toBeGreaterThan(20);
  }
  expect(results.at(2)?.payload.citations.length).toBeGreaterThan(0);
});
