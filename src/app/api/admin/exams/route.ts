import { EXAM_CATEGORIES, EXAM_REGIONS } from "@/domain/exam-catalog";
import { digest } from "@/lib/server/account-auth";
import { fetchPublicWebpage } from "@/lib/server/webpage-fetcher";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { collectSource } from "@/lib/server/exam-collector";
import {
  listNotices,
  noticeHistory,
  noticeInputSchema,
  publishNotice,
  saveDraft,
  sources,
} from "@/lib/server/exam-store";
import { consumeRate, platformDb } from "@/lib/server/platform-db";
import { readSmallJson } from "@/lib/server/request-json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<NextResponse> {
  if (sessionAccount(request)?.role !== "admin")
    return NextResponse.json({ error: "需要内容管理员权限。" }, { status: 403 });
  return NextResponse.json({
    sources: sources(),
    notices: listNotices(true),
    runs: platformDb().prepare("SELECT * FROM exam_fetch_runs ORDER BY id DESC LIMIT 100").all(),
    history: new URL(request.url).searchParams.get("id")
      ? noticeHistory(new URL(request.url).searchParams.get("id")!)
      : [],
  });
}
export async function POST(request: Request): Promise<NextResponse> {
  const account = sessionAccount(request);
  if (account?.role !== "admin")
    return NextResponse.json({ error: "需要内容管理员权限。" }, { status: 403 });
  try {
    const raw = z
      .object({
        action: z.enum(["draft", "publish", "withdraw", "collect", "source", "register-source"]),
        id: z.string().max(100).optional(),
        version: z.number().int().positive().optional(),
        sourceId: z.string().max(100).optional(),
        url: z.url().max(2048).optional(),
        content: noticeInputSchema.optional(),
        enabled: z.boolean().optional(),
        intervalHours: z.number().int().min(1).max(168).optional(),
        name: z.string().trim().min(1).max(200).optional(),
        category: z.string().max(50).optional(),
        region: z.string().max(30).optional(),
      })
      .strict()
      .parse(await readSmallJson(request, 1024 * 1024));
    if (raw.action === "register-source") {
      const input = z
        .object({
          url: z.url(),
          name: z.string().trim().min(1).max(200),
          category: z.enum(EXAM_CATEGORIES.map((item) => item[0])),
          region: z.enum(EXAM_REGIONS),
        })
        .parse({ url: raw.url, name: raw.name, category: raw.category, region: raw.region });
      const url = new URL(input.url);
      if (
        url.protocol !== "https:" ||
        !/(?:\.gov\.cn|\.edu\.cn|(?:^|\.)chsi\.com\.cn)$/.test(url.hostname)
      )
        throw new Error(
          "请使用HTTPS的政府、教育机构或研招网来源；其他机构域名需另行核验后加入适配器。",
        );
      const page = await fetchPublicWebpage(input.url);
      if (new URL(page.url).hostname !== url.hostname)
        throw new Error("入口跨主机跳转，请核对最终官方地址后重新登记。");
      platformDb()
        .prepare(
          "INSERT OR IGNORE INTO exam_sources(id,name,url,category,region) VALUES (?,?,?,?,?)",
        )
        .run(digest(page.url).slice(0, 24), input.name, page.url, input.category, input.region);
      return NextResponse.json({
        ok: true,
        message: `来源入口已核验可读：${page.title}；定时采集尚未启用，请先采集并核对草稿。`,
      });
    }
    if (raw.action === "draft") {
      if (!raw.sourceId || !raw.url || !raw.content)
        throw new Error("缺少来源、原文地址或公告内容。");
      return NextResponse.json(saveDraft(raw.sourceId, raw.url, raw.content, account.id));
    }
    if (raw.action === "publish" || raw.action === "withdraw") {
      if (!raw.id) throw new Error("缺少公告ID。");
      publishNotice(raw.id, account.id, raw.action === "withdraw", raw.version);
      return NextResponse.json({ ok: true });
    }
    if (raw.action === "collect") {
      if (!raw.id || !consumeRate(`collect:${account.id}`, 5, 600000))
        throw new Error("请选择来源；每10分钟最多手动采集5次。");
      return NextResponse.json(await collectSource(raw.id));
    }
    if (raw.action === "source") {
      if (!raw.id || !sources().some((s) => s.id === raw.id))
        throw new Error("来源不存在。新增来源须先通过本地受控工具核验域名与访问条件。");
      platformDb()
        .prepare("UPDATE exam_sources SET enabled=?,interval_hours=?,next_run=? WHERE id=?")
        .run(raw.enabled ? 1 : 0, raw.intervalHours ?? 6, Date.now(), raw.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作未完成。" },
      { status: 400 },
    );
  }
}
