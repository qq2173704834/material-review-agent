import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { campusState, campusNotices, mutateCampus } from "@/lib/server/campus-store";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  const state = campusState(user.id);
  return NextResponse.json(
    { state, notices: campusNotices(state.preferences.schoolId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const state = mutateCampus(user.id, await readSmallJson(request, 200000));
    return NextResponse.json({ state, notices: campusNotices(state.preferences.schoolId) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ZodError
            ? "请核对必填项、日期及时间顺序。"
            : error instanceof Error
              ? error.message
              : "保存失败。",
      },
      { status: 400 },
    );
  }
}
