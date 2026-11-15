import { readLimitedFormData } from "@/lib/server/limited-form-data";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { fetchPublicWebpage } from "@/lib/server/webpage-fetcher";
import { parseMaterial } from "@/lib/server/material-parser";
import { campusImportPreview } from "@/lib/campus";
export const runtime = "nodejs";
const schema = z
  .object({
    text: z.string().max(30000).default(""),
    url: z.string().max(2000).default(""),
    referenceDate: z.string().max(10).default(""),
  })
  .strict();
export async function POST(request: Request): Promise<Response> {
  if (!sessionAccount(request)) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    let text = "",
      referenceDate = "",
      partial = false;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length") || 0) > 11 * 1024 * 1024)
        throw new Error("文件不能超过10MB。");
      const form = await readLimitedFormData(request, 10 * 1024 * 1024),
        file = form.get("file");
      referenceDate = String(form.get("referenceDate") || "").slice(0, 10);
      if (
        !(file instanceof File) ||
        file.size > 10 * 1024 * 1024 ||
        !/\.(pdf|docx|txt|jpe?g|png)$/iu.test(file.name)
      )
        throw new Error("请选择10MB以内的PDF、DOCX、TXT、JPG或PNG。");
      const parsed = await parseMaterial(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        request.signal,
      );
      if (!parsed.extractedText.trim()) throw new Error("未能读取文字，请粘贴通知内容或手动添加。");
      text = parsed.extractedText.slice(0, 30000);
      partial = parsed.parseStatus !== "text_extracted";
    } else {
      const input = schema.parse(await readSmallJson(request, 40000));
      text = input.url ? (await fetchPublicWebpage(input.url)).text.slice(0, 30000) : input.text;
      referenceDate = input.referenceDate;
    }
    if (!text.trim()) throw new Error("请填写通知文字。");
    return NextResponse.json({ drafts: campusImportPreview(text, referenceDate), partial });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "识别失败，输入已保留。" },
      { status: 400 },
    );
  }
}
