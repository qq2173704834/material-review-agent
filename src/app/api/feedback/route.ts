import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { platformDb, consumeRate } from "@/lib/server/platform-db";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
const schema = z
  .object({
    kind: z.enum(["资料问题", "回答问题"]),
    id: z
      .string()
      .regex(/^[a-f0-9-]{32,36}$/)
      .optional(),
    note: z.string().trim().min(2).max(1000),
    answer: z.string().max(6000).optional(),
    citations: z
      .array(
        z
          .object({
            id: z.string().max(80),
            version: z.number().int().positive(),
            quote: z.string().max(1200),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();
export async function POST(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = schema.parse(await readSmallJson(request, 20000));
    if (!consumeRate(`feedback:${account.id}`, 20, 86400000)) throw new Error("每日最多20条反馈。");
    const now = new Date().toISOString();
    platformDb()
      .prepare(
        "INSERT INTO portal_feedback(id,user_id,kind,payload,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(randomUUID(), account.id, input.kind, JSON.stringify(input), now, now);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "反馈失败" },
      { status: 400 },
    );
  }
}
export async function GET(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  return NextResponse.json({
    items: platformDb()
      .prepare(
        "SELECT id,kind,status,response,created_at FROM portal_feedback WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(account.id),
  });
}
