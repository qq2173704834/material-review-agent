import { test, expect } from "@playwright/test";
import { documentBlocks } from "../../src/lib/document-blocks";
test("DOCX转换结构保留表格行列、合并说明和上下文 S03 S08 M03", () => {
  const blocks = documentBlocks(
    "<h1>申请书</h1><p>上文</p><table><tr><th>字段</th><th>值</th></tr><tr><td>项目名称</td><td>能源系统</td></tr><tr><td colspan='2'>合并说明</td></tr></table><p>下文</p>",
  );
  expect(blocks.map((block) => block.text)).toEqual([
    "申请书",
    "上文",
    "字段 | 值",
    "项目名称 | 能源系统",
    "合并说明",
    "下文",
  ]);
  expect(blocks[3]!.location).toContain("表格 1 第 2 行（列1-2");
  expect(blocks[4]!.location).toContain("含合并单元格");
});
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";

test("真实DOCX表格与图片区域解析 M03 S08 C14", async ({ request }) => {
  test.setTimeout(120000);
  const { task } = await (
    await request.post("/api/tasks", {
      data: { name: "表格图像", noticeText: "申请材料必须盖章。" },
    })
  ).json();
  try {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "_rels/.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>申请书</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>能源系统</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    );
    const docx = await request.post(`/api/tasks/${task.id}/materials`, {
      multipart: {
        files: {
          name: "申请书.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: await zip.generateAsync({ type: "nodebuffer" }),
        },
      },
    });
    expect(docx.status()).toBe(201);
    const canvas = createCanvas(1000, 500),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1000, 500);
    ctx.fillStyle = "black";
    ctx.font = "40px Arial";
    ctx.fillText("BUDGET TABLE", 40, 70);
    ctx.fillText("Equipment", 40, 160);
    ctx.fillText("1000", 700, 160);
    ctx.fillText("Services", 40, 250);
    ctx.fillText("2000", 700, 250);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(850, 390, 60, 0, Math.PI * 2);
    ctx.stroke();
    expect(
      (
        await request.post(`/api/tasks/${task.id}/materials`, {
          multipart: {
            files: {
              name: "图像证明.png",
              mimeType: "image/png",
              buffer: canvas.toBuffer("image/png"),
            },
          },
        })
      ).status(),
    ).toBe(201);
    const saved = (await (await request.get(`/api/tasks/${task.id}`)).json()).task;
    const document = saved.materials.find(
      (material: { extension: string }) => material.extension === "docx",
    );
    expect(document.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "项目名称 | 能源系统",
          location: expect.stringContaining("表格 1 第 1 行"),
        }),
      ]),
    );
    const image = saved.materials.find(
      (material: { extension: string }) => material.extension === "png",
    );
    expect(image.extractedText).toContain("1000");
    expect(image.extractedText).toContain("2000");
    expect(
      image.segments.some((segment: { location: string }) => /OCR 第.*x=/.test(segment.location)),
    ).toBe(true);
    expect(
      image.segments.some((segment: { location: string }) =>
        segment.location.includes("图像辅助区域"),
      ),
    ).toBe(true);
    await request.post(`/api/tasks/${task.id}/rules`);
    await request.post(`/api/tasks/${task.id}/checks`);
    const result = (await (await request.get(`/api/tasks/${task.id}/checks`)).json()).executions[0]
      .results[0];
    expect(result.verdict).toBe("needs_confirmation");
    expect(result.reason).toContain("真实性");
    expect(
      result.evidence.some((evidence: { location: string }) =>
        evidence.location.includes("图像辅助区域"),
      ),
    ).toBe(true);
  } finally {
    await request.delete(`/api/tasks/${task.id}`);
  }
});
