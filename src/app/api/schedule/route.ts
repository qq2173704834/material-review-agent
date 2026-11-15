import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { mutateScheduleNode, personalSchedule } from "@/lib/server/personal-schedule";

export const runtime = "nodejs";
export function GET(request: Request): Response {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  return NextResponse.json(
    { nodes: personalSchedule(user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    mutateScheduleNode(user.id, await readSmallJson(request, 12000));
    return NextResponse.json({ nodes: personalSchedule(user.id) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ZodError
            ? "请核对日期与操作。"
            : error instanceof Error
              ? error.message
              : "保存失败。",
      },
      { status: 400 },
    );
  }
}
