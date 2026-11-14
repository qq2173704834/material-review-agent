import { platformDb } from "@/lib/server/platform-db";
import { pauseGoalReview } from "@/lib/server/goal-review";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { goalInputSchema } from "@/domain/student-goal";
import { saveGoal, studentGoals } from "@/lib/server/student-goals";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  return NextResponse.json({ goals: studentGoals(user.id) });
}
export async function POST(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = z
      .object({ id: z.string().uuid().optional(), goal: goalInputSchema })
      .strict()
      .parse(await readSmallJson(request, 16000));
    return NextResponse.json({ goal: saveGoal(user.id, input.goal, input.id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存失败。" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await readSmallJson(request, 1000));
    pauseGoalReview(user.id, input.id);
    platformDb()
      .prepare("DELETE FROM student_goals WHERE id=? AND user_id=?")
      .run(input.id, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "清除失败。" }, { status: 400 });
  }
}
