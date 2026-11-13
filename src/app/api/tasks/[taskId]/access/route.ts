import { accountByUsername, accountById } from "@/lib/server/account-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accessUsers, isLegacyTestMode, requestIdentity } from "@/lib/server/access-config";
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
    users: isLegacyTestMode() ? accessUsers().map((user) => user.id) : store.taskGrants(taskId),
    legacy: isLegacyTestMode(),
    labels: Object.fromEntries(
      store.taskGrants(taskId).map((id) => [id, accountById(id)?.username ?? "已删除账号"]),
    ),
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
    .object({
      userId: z.string().max(64).optional(),
      username: z.string().max(32).optional(),
      enabled: z.boolean(),
    })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "授权请求无效。" }, { status: 400 });
  const userId = isLegacyTestMode()
    ? accessUsers().find((user) => user.id === input.data.userId)?.id
    : input.data.username
      ? accountByUsername(input.data.username)?.id
      : input.data.userId && store.taskGrants(taskId).includes(input.data.userId)
        ? input.data.userId
        : undefined;
  if (!userId || userId === store.taskOwner(taskId))
    return NextResponse.json({ error: "请填写其他已注册账号的准确用户名。" }, { status: 400 });
  store.setTaskGrant(taskId, userId, input.data.enabled);
  return NextResponse.json({ grants: store.taskGrants(taskId) });
}
