import { test, expect } from "@playwright/test";

test("命名模板使用材料字段并保留证据，字段缺失时待确认 ENG-007", async ({ request }) => {
  for (const sample of [
    { name: "节水_甲.txt", text: "项目名称：节水\n负责人：甲", expected: "passed" },
    { name: "随意.txt", text: "项目名称：节水\n负责人：甲", expected: "failed" },
    { name: "节水_甲.txt", text: "项目名称：节水", expected: "needs_confirmation" },
  ]) {
    const { task } = await (
      await request.post("/api/tasks", {
        data: { name: "命名模板", noticeText: "文件名必须为“{项目名称}_{负责人}.txt”。" },
      })
    ).json();
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: sample.name, mimeType: "text/plain", buffer: Buffer.from(sample.text) },
      },
    });
    await request.post(`/api/tasks/${task.id}/rules`);
    await request.post(`/api/tasks/${task.id}/checks`);
    const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(executions[0].results[0].verdict).toBe(sample.expected);
    await request.delete(`/api/tasks/${task.id}`);
  }
});
