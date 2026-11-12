import { expect, test } from "@playwright/test";

test("两个领域的演示独立创建、载入修订和重新开始 ENG-010", async ({ request, page }) => {
  const created: string[] = [];
  for (const domain of ["competition", "grant"]) {
    const response = await request.post("/api/demos", { data: { domain } });
    expect(response.status()).toBe(201);
    const { taskId } = await response.json();
    created.push(taskId);
    const initial = (await (await request.get(`/api/tasks/${taskId}`)).json()).task;
    expect(initial.materials).toHaveLength(2);
    await page.goto(`/tasks/${taskId}`);
    await page.getByRole("button", { name: "载入演示修订材料" }).click();
    await expect(page.getByRole("status")).toContainText("修订材料已载入");
    const revised = (await (await request.get(`/api/tasks/${taskId}`)).json()).task;
    expect(revised.materials).toHaveLength(3);
    expect(
      revised.materials.filter((item: { version: number }) => item.version === 2),
    ).toHaveLength(2);
    await expect(
      page.getByText(domain === "competition" ? "授权证明.txt" : "预算说明.txt", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "重新创建初始案例" }).click();
    await expect(page).not.toHaveURL(`/tasks/${taskId}`);
    const resetId = new URL(page.url()).pathname.split("/").pop()!;
    created.push(resetId);
    expect((await (await request.get(`/api/tasks/${resetId}`)).json()).task.materials).toHaveLength(
      2,
    );
    expect((await (await request.get(`/api/tasks/${taskId}`)).json()).task.materials).toHaveLength(
      3,
    );
  }
  for (const id of created) await request.delete(`/api/tasks/${id}`);
});
