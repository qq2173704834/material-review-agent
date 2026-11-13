import { NextResponse } from "next/server";
import { z } from "zod";
import { accessUsers, requestIdentity } from "@/lib/server/access-config";
import { getReviewStore } from "@/lib/server/review-store";
export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await context.params;
  const store = getReviewStore();
  if (store.taskOwner(taskId) !== requestIdentity(request))
    return NextResponse.json({ error: "仅任务所有者可管理授权。" }, { status: 403 });
  return NextResponse.json({
    owner: store.taskOwner(taskId),
    grants: store.taskGrants(taskId),
    users: accessUsers().map((user) => user.id),
  });
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await context.params;
  const store = getReviewStore();
  if (store.taskOwner(taskId) !== requestIdentity(request))
    return NextResponse.json({ error: "仅任务所有者可管理授权。" }, { status: 403 });
  const input = z
    .object({ userId: z.string().max(64), enabled: z.boolean() })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!input.success || !accessUsers().some((user) => user.id === input.data.userId))
    return NextResponse.json({ error: "请选择已配置的本地身份。" }, { status: 400 });
  store.setTaskGrant(taskId, input.data.userId, input.data.enabled);
  return NextResponse.json({ grants: store.taskGrants(taskId) });
}
