import { studentGoal } from "@/lib/server/student-goals";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import {
  adoptGoalNotice,
  configureGoalReview,
  pauseGoalReview,
  goalReviewTick,
} from "@/lib/server/goal-review";
export async function POST(request: Request): Promise<Response> {
  const account = sessionAccount(request);
  if (!account) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = z
      .object({
        goalId: z.string().uuid(),
        stage: z.string().trim().min(1).max(80).default("报名材料准备"),
        auto: z.boolean(),
        pause: z.boolean().optional(),
        adopt: z.boolean().optional(),
        checkNow: z.boolean().optional(),
      })
      .strict()
      .parse(await readSmallJson(request, 2000));
    if (input.checkNow) {
      const goal = studentGoal(account.id, input.goalId);
      if (!goal?.autoReview) throw new Error("目标不存在或自动预审未开启。");
      await goalReviewTick(account.id, goal.id);
      return NextResponse.json({ ok: true });
    }
    if (input.adopt) {
      adoptGoalNotice(account.id, input.goalId);
      return NextResponse.json({ ok: true });
    }
    if (input.pause) {
      pauseGoalReview(account.id, input.goalId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({
      taskId: configureGoalReview(account.id, input.goalId, input.stage, input.auto),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败。" },
      { status: 400 },
    );
  }
}
