import { expect, test } from "@playwright/test";

test("预算明细以分精确合计并对不完整数值保留待确认 ENG-007", async ({ request }) => {
  for (const sample of [
    { text: "项目,金额（元）\n材料,0.10\n服务,0.20\n合计,0.30", verdict: "passed" },
    { text: "项目,金额（元）\n材料,100\n服务,200\n合计,299", verdict: "failed" },
    { text: "项目,金额（元）\n材料,\n合计,0", verdict: "needs_confirmation" },
  ]) {
    const { task } = await (
      await request.post("/api/tasks", {
        data: { name: "预算合计", noticeText: "预算合计必须与明细之和一致。" },
      })
    ).json();
    await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: { name: "预算.csv", mimeType: "text/csv", buffer: Buffer.from(sample.text) },
      },
    });
    await request.post(`/api/tasks/${task.id}/rules`);
    await request.post(`/api/tasks/${task.id}/checks`);
    const { executions } = await (await request.get(`/api/tasks/${task.id}/checks`)).json();
    expect(executions[0].results[0].verdict).toBe(sample.verdict);
    await request.delete(`/api/tasks/${task.id}`);
  }
});

test("预算比例按整数交叉相乘并处理零总额 C10", async ({ request }) => {
  for (const sample of [
    { amount: "30", total: "100", verdict: "passed" },
    { amount: "30.01", total: "100", verdict: "failed" },
    { amount: "0", total: "0", verdict: "needs_confirmation" },
  ]) {
    const { task } = await (
      await request.post("/api/tasks", {
        data: { name: "预算比例", noticeText: "预算中设备费占比不超过30%。" },
      })
    ).json();
    try {
      await request.post(`/api/tasks/${task.id}/materials`, {
        multipart: {
          files: {
            name: "预算.csv",
            mimeType: "text/csv",
            buffer: Buffer.from(`项目,金额（元）\n设备费,${sample.amount}\n合计,${sample.total}`),
          },
        },
      });
      await request.post(`/api/tasks/${task.id}/rules`);
      await request.post(`/api/tasks/${task.id}/checks`);
      const result = (await (await request.get(`/api/tasks/${task.id}/checks`)).json())
        .executions[0].results[0];
      expect(result.verdict, result.reason).toBe(sample.verdict);
    } finally {
      await request.delete(`/api/tasks/${task.id}`);
    }
  }
});
