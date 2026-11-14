import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { examReminders, markReminderRead } from "@/lib/server/exam-reminders";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  return NextResponse.json({ reminders: examReminders(account.id) });
}
export async function POST(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  try {
    const input = z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .strict()
      .parse(await readSmallJson(request, 1000));
    markReminderRead(account.id, input.id, input.version);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存失败。" },
      { status: 400 },
    );
  }
}
