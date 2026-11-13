import { test, expect } from "@playwright/test";

test("任意文件名按内容提供分类线索，人工纠正持久化且触发复检 ENG-006", async ({
  request,
  page,
}) => {
  const { task } = await (
    await request.post("/api/tasks", { data: { name: "内容分类", noticeText: "必须提交申请书。" } })
  ).json();
  await request.post(`/api/tasks/${task.id}/materials`, {
    multipart: {
      files: {
        name: "随意.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("申请书\n项目名称：合成示例\n负责人：甲"),
      },
    },
  });
  await request.post(`/api/tasks/${task.id}/rules`);
  await request.post(`/api/tasks/${task.id}/checks`);
  const material = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0];
  expect(material.classification).toMatchObject({ label: "申请书", method: "content" });
  await page.goto(`/tasks/${task.id}?view=prepare&verdict=all`);
  await expect(page.getByText(/材料类型：申请书 · 内容线索/)).toBeVisible();
  await page.getByText("核对与修订解析文字", { exact: true }).click();
  await page.getByLabel("材料类型（人工核对）", { exact: true }).fill("申报书");
  await page.getByLabel("修订依据", { exact: true }).fill("对照原件确认属于申报表单");
  await page.getByRole("button", { name: "保存材料类型", exact: true }).click();
  await expect(page.getByText(/材料类型：申报书 · 人工指定/)).toBeVisible();
  const current = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials[0];
  expect(current.version).toBe(2);
  expect(current.classification.method).toBe("manual");
  expect(
    (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0].validity,
  ).toBe("needs_recheck");
  await request.delete(`/api/tasks/${task.id}`);
});
