import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { portalPreferences } from "@/lib/server/student-goals";
import { platformDb } from "@/lib/server/platform-db";
import { learningRecommendations, resourceMark } from "@/lib/server/learning-store";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    return NextResponse.json({
      resources: learningRecommendations(
        account.id,
        new URL(request.url).searchParams.get("goal") ?? undefined,
      ),
      preferences: portalPreferences(account.id),
    });
  } catch {
    return NextResponse.json({ error: "考试目标不存在。" }, { status: 404 });
  }
}
export async function POST(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("mark"),
            id: z.string().regex(/^[a-f0-9-]{32,36}$/),
            field: z.enum(["saved", "seen", "dismissed"]),
            value: z.boolean(),
          })
          .strict(),
        z
          .object({
            action: z.literal("preferences"),
            personalized: z.boolean(),
            retainChat: z.boolean(),
            externalEnabled: z.boolean().optional(),
          })
          .strict(),
      ])
      .parse(await readSmallJson(request, 5000));
    if (input.action === "mark") resourceMark(account.id, input.id, input.field, input.value);
    else {
      const db = platformDb();
      db.transaction(() => {
        db.prepare(
          "INSERT INTO portal_preferences(user_id,personalized,retain_chat) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET personalized=excluded.personalized,retain_chat=excluded.retain_chat",
        ).run(account.id, input.personalized ? 1 : 0, input.retainChat ? 1 : 0);
        if (input.externalEnabled !== undefined)
          db.prepare(
            "INSERT INTO assistant_preferences(user_id,external_enabled) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET external_enabled=excluded.external_enabled",
          ).run(account.id, input.externalEnabled ? 1 : 0);
      })();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存失败。" },
      { status: 400 },
    );
  }
}
