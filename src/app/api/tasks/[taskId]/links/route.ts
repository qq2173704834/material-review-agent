import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { getReviewStore } from "@/lib/server/review-store";
import { fetchPublicResource, extractWebpageContent } from "@/lib/server/webpage-fetcher";

export const runtime = "nodejs";
const schema = z.object({
  url: z.string().url().max(2048),
  name: z.string().trim().min(1).max(120),
  repository: z.boolean().default(false),
});
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(taskId).success || !input.success)
    return NextResponse.json({ error: "请填写链接名称和公开URL。" }, { status: 400 });
  const store = getReviewStore();
  const task = store.getTask(taskId);
  if (!task) return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  let state = "network_failed";
  let status: number | null = null;
  let finalUrl = input.data.url;
  let message: string;
  let incomplete = false;
  const parts: Array<{ text: string; location: string }> = [];
  try {
    const probe = await fetchPublicResource(input.data.url, true);
    status = probe.status;
    finalUrl = probe.url;
    state = [401, 403, 407].includes(status)
      ? "login_required"
      : status >= 200 && status < 300
        ? "accessible"
        : status === 404 || status === 410
          ? "not_found"
          : "http_error";
    message = `HTTP ${status}`;
    if (state === "accessible") {
      try {
        const resource = await fetchPublicResource(finalUrl);
        if (!/text\/|html|json|xml|yaml/i.test(resource.contentType))
          throw new Error("该链接内容不是可读网页或文本。");
        const text = new TextDecoder().decode(resource.bytes);
        const content = /html/i.test(resource.contentType)
          ? extractWebpageContent(text, finalUrl).text
          : text;
        if (content.length > 40000) incomplete = true;
        parts.push({ text: content.slice(0, 40000), location: `网页正文 · ${finalUrl}` });
      } catch {
        incomplete = true;
        message += "；正文读取失败或超限，访问状态不代表内容已核验。";
      }
    }
  } catch (error) {
    message = error instanceof Error ? error.message : "网络失败。";
    if (/非公开|仅支持|有效的公开/.test(message))
      return NextResponse.json({ error: message }, { status: 422 });
  }
  if (input.data.repository) {
    const url = new URL(input.data.url);
    const match =
      url.hostname === "github.com" ? url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/) : null;
    if (!match)
      return NextResponse.json(
        { error: "仓库资料导入支持公开GitHub仓库根地址，不下载或运行代码。" },
        { status: 422 },
      );
    const base = `https://api.github.com/repos/${match[1]}/${match[2]}`;
    const repositoryFileSchema = z.object({
      type: z.literal("file"),
      encoding: z.literal("base64"),
      content: z.string().max(4_000_000),
      size: z.number().int().nonnegative().max(2_000_000),
      sha: z.string().regex(/^[a-f0-9]{40,64}$/),
      name: z.string().max(200),
    });
    for (const path of ["README", "package.json", "requirements.txt", ".env.example"]) {
      const endpoint = path === "README" ? base + "/readme" : base + "/contents/" + path;
      try {
        const resource = await fetchPublicResource(endpoint);
        const information = repositoryFileSchema.parse(
          JSON.parse(new TextDecoder().decode(resource.bytes)),
        );
        const repositoryText = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(information.content.replace(/\s/g, ""), "base64"),
        );
        if (repositoryText.length > 20000) incomplete = true;
        parts.push({
          text: repositoryText.slice(0, 20000),
          location: `仓库文件 ${information.name} · blob ${information.sha} · ${resource.url}`,
        });
      } catch (error) {
        incomplete = true;
        const missing = error instanceof Error && /HTTP 404/.test(error.message);
        parts.push({
          text: missing
            ? `公开内容接口在此次读取时未找到 ${path}（HTTP 404）；只反映当前公开分支。`
            : `未能取得 ${path}；可能受限或网络失败，不能据此断言缺失。`,
          location: `仓库文件 ${path} · ${missing ? "HTTP 404" : "未读取"}`,
        });
      }
    }
  }
  const fetchedAt = new Date().toISOString();
  const header = JSON.stringify({
    url: input.data.url,
    finalUrl,
    status,
    state,
    fetchedAt,
    message,
    repository: input.data.repository,
  });
  const blocks = [{ text: header, location: "链接访问记录" }, ...parts];
  let text = "";
  const segments = blocks
    .filter((block) => block.text.trim())
    .map((block, segmentIndex) => {
      if (text) text += "\n";
      const startOffset = text.length;
      text += block.text;
      return { ...block, segmentIndex, startOffset, endOffset: text.length };
    });
  const name = input.data.name.replace(/[\\/:*?"<>|\p{Cc}]/gu, "_") + ".url";
  const previous = task.materials.find((material) => material.originalFileName === name);
  const id = previous?.id ?? randomUUID();
  const version = (previous?.version ?? 0) + 1;
  const bytes = Buffer.from(text);
  const key = `materials/${taskId}/${randomUUID()}`;
  const root = resolve(process.env.REVIEW_DATA_DIR?.trim() || ".local-data");
  await mkdir(resolve(root, "materials", taskId), { recursive: true });
  await writeFile(resolve(root, key), bytes, { flag: "wx", mode: 0o600 });
  try {
    const material = store.saveMaterialVersion({
      id,
      version,
      taskId,
      originalFileName: name,
      mediaType: "text/plain",
      extension: "url",
      fileSizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storageKey: key,
      parseStatus:
        state === "accessible" && parts.length && !incomplete ? "text_extracted" : "partial",
      parserName: "public-link",
      extractedText: text,
      segments,
      pageCount: null,
      sheetNames: [],
      parseMessage: `链接状态：${state}；${message}；仅反映${fetchedAt}的访问，不保证后续可用。`,
      createdAt: fetchedAt,
    });
    return NextResponse.json({ material, state, status }, { status: 201 });
  } catch {
    await rm(resolve(root, key), { force: true });
    return NextResponse.json({ error: "链接保存失败。" }, { status: 500 });
  }
}
