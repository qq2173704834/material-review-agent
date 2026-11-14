import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { learningContentSchema } from "@/domain/learning-content";
import {
  learningEntries,
  learningHistory,
  publishLearningContent,
  saveLearningContent,
  inspectKnowledgeIndex,
} from "@/lib/server/learning-store";
import { platformDb } from "@/lib/server/platform-db";
import { readSmallJson } from "@/lib/server/request-json";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  if (sessionAccount(request)?.role !== "admin")
    return NextResponse.json({ error: "需要内容管理员。" }, { status: 403 });
  return NextResponse.json({
    dailyCheckHour: Number(
      platformDb()
        .prepare<[string], { value: string }>("SELECT value FROM portal_settings WHERE key=?")
        .get("daily-check-hour")?.value ?? 8,
    ),
    entries: learningEntries(true).map((entry) => ({
      ...entry,
      history: learningHistory(entry.id),
    })),
    feedback: platformDb()
      .prepare(
        "SELECT id,kind,payload,status,response,created_at FROM portal_feedback ORDER BY created_at DESC LIMIT 100",
      )
      .all(),
    runs: platformDb().prepare("SELECT * FROM portal_daily_runs ORDER BY day DESC LIMIT 30").all(),
    indexCheck: JSON.parse(
      platformDb()
        .prepare<[string], { value: string }>("SELECT value FROM portal_settings WHERE key=?")
        .get("knowledge-index-check")?.value ?? "null",
    ),
  });
}
export async function POST(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (account?.role !== "admin")
    return NextResponse.json({ error: "需要内容管理员。" }, { status: 403 });
  try {
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("check-index") }).strict(),
        z.object({ action: z.literal("schedule"), hour: z.number().int().min(0).max(23) }).strict(),
        z
          .object({
            action: z.literal("feedback"),
            id: z.string().uuid(),
            response: z.string().trim().min(2).max(1000),
            status: z.enum(["处理中", "已处理", "无法确认"]),
          })
          .strict(),
        z
          .object({
            action: z.literal("draft"),
            id: z
              .string()
              .regex(/^[a-f0-9-]{32,36}$/)
              .optional(),
            version: z.number().int().positive().optional(),
            content: learningContentSchema,
          })
          .strict(),
        z
          .object({
            action: z.enum(["publish", "withdraw"]),
            id: z.string().regex(/^[a-f0-9-]{32,36}$/),
            version: z.number().int().positive(),
          })
          .strict(),
      ])
      .parse(await readSmallJson(request, 100000));
    if (input.action === "check-index")
      return NextResponse.json({ ok: true, indexCheck: inspectKnowledgeIndex() });
    if (input.action === "schedule") {
      platformDb()
        .prepare(
          "INSERT INTO portal_settings(key,value) VALUES ('daily-check-hour',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(String(input.hour));
      return NextResponse.json({ ok: true });
    }
    if (input.action === "feedback") {
      platformDb()
        .prepare("UPDATE portal_feedback SET status=?,response=?,updated_at=? WHERE id=?")
        .run(input.status, input.response, new Date().toISOString(), input.id);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "draft")
      return NextResponse.json({
        entry: saveLearningContent(input.content, account.id, input.id, input.version),
      });
    await publishLearningContent(input.id, input.version, account.id, input.action === "withdraw");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存失败。" },
      { status: 400 },
    );
  }
}
