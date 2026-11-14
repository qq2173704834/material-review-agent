import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import {
  assistantInputSchema,
  askExamAssistant,
  assistantConversations,
  assistantMessages,
} from "@/lib/server/exam-assistant";
import { studentGoals, portalPreferences } from "@/lib/server/student-goals";
import { platformDb } from "@/lib/server/platform-db";
import { getAiMode, modelErrorResponse, ModelServiceError } from "@/lib/server/model-client";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const id = new URL(request.url).searchParams.get("conversation");
    return NextResponse.json({
      mode: getAiMode(),
      conversations: assistantConversations(account.id),
      goals: studentGoals(account.id),
      preferences: portalPreferences(account.id),
      messages: id ? assistantMessages(account.id, z.string().uuid().parse(id)) : [],
    });
  } catch {
    return NextResponse.json({ error: "会话不存在或服务未配置。" }, { status: 404 });
  }
}
export async function POST(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = assistantInputSchema.parse(await readSmallJson(request, 14000));
    return NextResponse.json(await askExamAssistant(account.id, input, request.signal));
  } catch (error) {
    if (error instanceof ModelServiceError) {
      const response = modelErrorResponse(error);
      return NextResponse.json(response, { status: response.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "助手请求失败。" },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = z
      .object({ id: z.string().uuid().optional(), all: z.boolean().optional() })
      .strict()
      .parse(await readSmallJson(request, 1000));
    if (!input.id && !input.all) throw new Error("请选择会话。");
    if (input.all)
      platformDb().prepare("DELETE FROM assistant_conversations WHERE user_id=?").run(account.id);
    else
      platformDb()
        .prepare("DELETE FROM assistant_conversations WHERE user_id=? AND id=?")
        .run(account.id, input.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除失败。" }, { status: 400 });
  }
}
