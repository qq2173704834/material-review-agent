import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import {
  preparationState,
  mutatePreparation,
  generatePreparation,
} from "@/lib/server/preparation-store";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    return NextResponse.json({
      state: preparationState(user.id, new URL(request.url).searchParams.get("goal") ?? ""),
    });
  } catch {
    return NextResponse.json({ error: "考试目标不存在。" }, { status: 404 });
  }
}
export async function POST(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const raw = await readSmallJson(request, 64000);
    const state =
      new URL(request.url).searchParams.get("generate") === "1"
        ? await generatePreparation(user.id, raw, request.signal)
        : mutatePreparation(user.id, raw);
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ZodError
            ? "输入格式不正确，请核对日期、必填项和数值范围。"
            : error instanceof Error
              ? error.message
              : "保存失败，请重试。",
      },
      { status: 400 },
    );
  }
}
