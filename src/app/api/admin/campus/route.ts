import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { campusDb, campusNotices, moderateCampusNotice } from "@/lib/server/campus-store";
import { collectCampusSource } from "@/lib/server/campus-collector";
import { CAMPUS_SOURCES } from "@/domain/campus-schools";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  if (sessionAccount(request)?.role !== "admin")
    return NextResponse.json({ error: "仅管理员可操作。" }, { status: 403 });
  const db = campusDb();
  return NextResponse.json({
    sources: CAMPUS_SOURCES.map((source) => ({
      ...source,
      settings: db.prepare("SELECT * FROM campus_source_settings WHERE id=?").get(source.id),
      run: db.prepare("SELECT * FROM campus_source_runs WHERE id=?").get(source.id),
    })),
    notices: [...new Set(CAMPUS_SOURCES.map((source) => source.schoolId))].flatMap((id) =>
      campusNotices(id),
    ),
    requests: db
      .prepare(
        "SELECT name,url,created_at FROM campus_school_requests_v2 ORDER BY created_at DESC LIMIT 100",
      )
      .all(),
  });
}
export async function POST(request: Request): Promise<Response> {
  if (sessionAccount(request)?.role !== "admin")
    return NextResponse.json({ error: "仅管理员可操作。" }, { status: 403 });
  try {
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("moderate"),
            id: z.string().max(100),
            withdrawn: z.boolean(),
          })
          .strict(),
        z.object({ action: z.literal("collect"), id: z.string() }).strict(),
        z.object({
          action: z.literal("settings"),
          id: z.string(),
          enabled: z.boolean(),
          intervalHours: z.number().int().min(6).max(168),
        }),
      ])
      .parse(await readSmallJson(request));
    if (input.action === "moderate") {
      moderateCampusNotice(input.id, input.withdrawn);
      return NextResponse.json({ saved: true });
    }
    if (!CAMPUS_SOURCES.some((source) => source.id === input.id)) throw new Error("来源未登记。");
    if (input.action === "collect")
      return NextResponse.json({ count: await collectCampusSource(input.id) });
    campusDb()
      .prepare(
        "INSERT INTO campus_source_settings(id,enabled,interval_hours) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,interval_hours=excluded.interval_hours",
      )
      .run(input.id, Number(input.enabled), input.intervalHours);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败。" },
      { status: 400 },
    );
  }
}
