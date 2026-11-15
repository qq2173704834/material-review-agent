import { expect, test } from "@playwright/test";
import { createReviewPdf, createOcrImage } from "../helpers/pdf-fixture";

test("文本、扫描、混合 PDF 逐页读取并保留失败范围 ENG-006", async ({ request, page }) => {
  test.setTimeout(120_000);
  const response = await request.post("/api/tasks", {
    data: { name: "PDF 逐页验收", noticeText: "必须提交 PDF 材料。" },
  });
  const { task } = await response.json();
  const imageUpload = await request.post("/api/tasks/" + task.id + "/materials", {
    multipart: { files: { name: "中英图片.png", mimeType: "image/png", buffer: createOcrImage() } },
  });
  expect(imageUpload.status()).toBe(201);
  for (const [name, pages] of [
    ["文本.pdf", ["text"]],
    ["扫描.pdf", ["scan"]],
    ["混合.pdf", ["text", "scan"]],
    ["含空页.pdf", ["text", "blank"]],
  ] as const) {
    const upload = await request.post("/api/tasks/" + task.id + "/materials", {
      multipart: {
        files: { name, mimeType: "application/pdf", buffer: createReviewPdf([...pages]) },
      },
    });
    expect(upload.status()).toBe(201);
  }
  const oversized = await request.post("/api/tasks/" + task.id + "/materials", {
    multipart: {
      files: {
        name: "超页数.pdf",
        mimeType: "application/pdf",
        buffer: createReviewPdf(Array.from({ length: 201 }, () => "text")),
      },
    },
  });
  expect(oversized.status()).toBe(201);
  const { task: saved } = await (await request.get("/api/tasks/" + task.id)).json();
  const byName = (name: string): (typeof saved.materials)[number] =>
    saved.materials.find(
      (material: { originalFileName: string }) => material.originalFileName === name,
    );
  expect(byName("中英图片.png").extractedText.replace(/\s/g, "")).toContain("绿色能源计划");
  expect(byName("中英图片.png").extractedText).toContain("12000");
  expect(byName("文本.pdf").pageCoverage).toMatchObject([
    { pageNumber: 1, method: "text", status: "read" },
  ]);
  expect(byName("扫描.pdf").extractedText).toContain("GREEN ENERGY");
  expect(byName("扫描.pdf").pageCoverage).toMatchObject([
    { pageNumber: 1, method: "ocr", status: "read" },
  ]);
  expect(byName("混合.pdf").pageCoverage).toMatchObject([
    { pageNumber: 1, method: "text", status: "read" },
    { pageNumber: 2, method: "ocr", status: "read" },
  ]);
  expect(byName("混合.pdf").segments[1]).toMatchObject({ location: "第 2 页 · OCR" });
  expect(byName("含空页.pdf").parseStatus).toBe("partial");
  expect(byName("含空页.pdf").pageCoverage[1]).toMatchObject({ pageNumber: 2, status: "failed" });
  expect(byName("超页数.pdf").pageCount).toBe(201);
  expect(byName("超页数.pdf").pageCoverage).toHaveLength(200);
  expect(byName("超页数.pdf").parseStatus).toBe("partial");
  expect(byName("超页数.pdf").parseMessage).toContain("第 201–201 页");
  await page.goto("/tasks/" + task.id);
  const material = page.locator("li[id='material-" + byName("混合.pdf").id + "']");
  await expect(material.getByRole("link", { name: "查看文件", exact: true })).toBeVisible();
  await expect(material.getByText("逐页读取范围", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(material.getByRole("link", { name: "查看文件", exact: true })).toBeVisible();
  const persisted = (await (await request.get(`/api/tasks/${task.id}`)).json()).task.materials.find(
    (item: { id: string }) => item.id === byName("混合.pdf").id,
  );
  expect(persisted.pageCoverage[1]).toMatchObject({ pageNumber: 2, method: "ocr", status: "read" });
  await request.delete("/api/tasks/" + task.id);
});
