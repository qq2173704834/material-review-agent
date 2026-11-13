import { requestOrigin } from "@/lib/public-origin";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { platformDirectory } from "@/lib/server/platform-db";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  accountById,
  accountByUsername,
  changePassword,
  checkPassword,
  createSession,
  normalizeUsername,
  publicAccount,
  registerAccount,
  resetPassword,
  revokeAll,
  revokeSession,
  sessionAccount,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "@/lib/server/account-auth";
import { consumeRate, platformDb, securityEvent } from "@/lib/server/platform-db";
import { readSmallJson } from "@/lib/server/request-json";
import { getReviewStore } from "@/lib/server/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const username = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/, "用户名为3—32位，以英文字母开头，包含字母、数字或下划线。")
  .transform(normalizeUsername);
const password = z
  .string()
  .min(12, "密码至少12位。")
  .max(128, "密码最多128位。")
  .refine(
    (value) =>
      !/^(.)\1+$/.test(value) &&
      !["password123456", "123456789012", "qwerty1234567"].includes(value.toLowerCase()),
    "请设置不易猜测的密码。",
  );
function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function sessionResponse(body: unknown, token: string, request: Request): NextResponse {
  const response = json(body);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(requestOrigin(request)).protocol === "https:",
    path: "/",
    maxAge: token ? SESSION_SECONDS : 0,
  });
  return response;
}
export async function GET(
  request: Request,
  context: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await context.params;
  if (!["me", "delete"].includes(action)) return json({ error: "没有此账号操作。" }, 404);
  const account = sessionAccount(request);
  if (!account) return json({ error: "请先登录。" }, 401);
  if (action === "delete") {
    const store = getReviewStore();
    const tasks = store
      .listTasks()
      .filter((task) => store.taskOwner(task.id) === account.id)
      .map((task) => ({
        id: task.id,
        name: task.name,
        materialCount: store.getTask(task.id)?.materials.length ?? 0,
      }));
    return json({
      account: publicAccount(account),
      deletionSummary: {
        tasks,
        scope:
          "所属任务、材料原件、解析、执行、收藏、恢复码及会话；撤销他人任务中对本账号的授权。安全动作记录保留，不含密码或材料正文。",
      },
    });
  }
  return json({ account: publicAccount(account) });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  let deletingUserId: string | undefined;
  try {
    const { action } = await context.params;
    if (action === "logout") {
      revokeSession(request);
      return sessionResponse({ ok: true }, "", request);
    }
    const raw = await readSmallJson(request);
    if (action === "register" || action === "login" || action === "recover") {
      if (!consumeRate(`auth-global:${action}`, action === "register" ? 30 : 100, 60_000))
        return json({ error: "请求过于频繁，请稍后重试。" }, 429);
      const input = z
        .object({
          username,
          password: action === "login" ? z.string().min(1).max(128) : password,
          nickname: z.string().trim().max(40).optional(),
          recoveryCode: z
            .string()
            .regex(/^[a-f0-9]{32}$/)
            .optional(),
        })
        .strict()
        .safeParse(raw);
      if (!input.success)
        return json({ error: input.error.issues[0]?.message ?? "输入无效。" }, 400);
      if (
        !consumeRate(
          `auth:${action}:${input.data.username}`,
          action === "register" ? 5 : 10,
          15 * 60_000,
        )
      )
        return json({ error: "该账号尝试过于频繁，请稍后重试。" }, 429);
      if (action === "register") {
        if (accountByUsername(input.data.username))
          return json({ error: "该用户名不可用，请选择其他用户名。" }, 409);
        try {
          const result = await registerAccount(
            input.data.username,
            input.data.password,
            input.data.nickname ?? "",
          );
          return json(
            {
              account: publicAccount(result.account),
              recoveryCodes: result.codes,
              message: "注册成功。请保存恢复码，再登录。",
            },
            201,
          );
        } catch {
          return json({ error: "注册未完成，请检查用户名或稍后重试。" }, 409);
        }
      }
      if (action === "recover") {
        if (!input.data.recoveryCode) return json({ error: "请输入注册时保存的恢复码。" }, 400);
        const codes = await resetPassword(
          input.data.username,
          input.data.recoveryCode,
          input.data.password,
        );
        return codes
          ? json({
              recoveryCodes: codes,
              message: "密码已重设，全部旧恢复码及登录已失效，请保存新恢复码。",
            })
          : json({ error: "用户名或恢复码无效，无法重设。" }, 400);
      }
      const account = accountByUsername(input.data.username);
      // A dummy derivation avoids a fast path for unknown usernames.
      const hash =
        account?.password_hash ?? "scrypt-v1$00000000000000000000000000000000$" + "00".repeat(64);
      if (!(await checkPassword(input.data.password, hash)) || !account || account.disabled)
        return json({ error: "用户名或密码不正确，或账号不可用。" }, 401);
      const fresh = accountByUsername(input.data.username);
      if (!fresh || fresh.disabled || fresh.password_hash !== hash)
        return json({ error: "账号状态已变化，请重新登录。" }, 401);
      securityEvent(account.id, "login");
      return sessionResponse(
        { account: publicAccount(account) },
        createSession(account.id),
        request,
      );
    }
    const account = sessionAccount(request);
    if (!account) return json({ error: "请先登录。" }, 401);
    if (!consumeRate(`account:${account.id}`, 20))
      return json({ error: "操作过于频繁，请稍后重试。" }, 429);
    if (action === "logout-all") {
      revokeAll(account.id);
      return sessionResponse({ ok: true }, "", request);
    }
    if (action === "profile") {
      const input = z
        .object({ nickname: z.string().trim().min(1).max(40) })
        .strict()
        .safeParse(raw);
      if (!input.success) return json({ error: "昵称应为1—40字。" }, 400);
      platformDb()
        .prepare("UPDATE accounts SET nickname=? WHERE id=?")
        .run(input.data.nickname, account.id);
      return json({ account: publicAccount(accountById(account.id)!) });
    }
    if (action === "password") {
      const input = z
        .object({ currentPassword: z.string().max(128), password })
        .strict()
        .safeParse(raw);
      if (!input.success) return json({ error: input.error.issues[0]?.message }, 400);
      const codes = await changePassword(account, input.data.currentPassword, input.data.password);
      return codes
        ? sessionResponse(
            { recoveryCodes: codes, message: "密码已修改，全部登录已退出，请保存新恢复码。" },
            "",
            request,
          )
        : json({ error: "当前密码不正确或账号已变化。" }, 400);
    }
    if (action === "delete") {
      const input = z
        .object({ password: z.string().max(128), confirmation: z.literal("注销并删除我的任务") })
        .strict()
        .safeParse(raw);
      const row = accountByUsername(account.username);
      if (!input.success || !row || !(await checkPassword(input.data.password, row.password_hash)))
        return json({ error: "请核对密码和注销确认内容。" }, 400);
      const store = getReviewStore();
      const owned = store.listTasks().filter((task) => store.taskOwner(task.id) === account.id);
      if (
        owned.some((task) =>
          store.listReviewExecutions(task.id).some((execution) => execution.status === "running"),
        )
      )
        return json({ error: "有任务正在审查，请先取消或等待完成后再注销。" }, 409);
      const locked = platformDb().transaction(() => {
        const result = platformDb()
          .prepare("UPDATE accounts SET disabled=2 WHERE id=? AND disabled=0 AND password_hash=?")
          .run(account.id, row.password_hash);
        if (result.changes) revokeAll(account.id);
        return result.changes;
      })();
      if (!locked) return json({ error: "账号状态已变化，请重新登录后核对。" }, 409);
      deletingUserId = account.id;
      for (const task of owned) {
        await rm(resolve(platformDirectory(), "materials", task.id), {
          recursive: true,
          force: true,
          maxRetries: 2,
        });
        store.deleteTask(task.id);
      }
      store.removeUserGrants(account.id);
      platformDb().prepare("DELETE FROM accounts WHERE id=?").run(account.id);
      securityEvent(account.id, "deleted");
      return sessionResponse({ ok: true }, "", request);
    }
    return json({ error: "没有此账号操作。" }, 404);
  } catch (error) {
    if (deletingUserId)
      platformDb()
        .prepare("UPDATE accounts SET disabled=0 WHERE id=? AND disabled=2")
        .run(deletingUserId);
    if (error instanceof SyntaxError) return json({ error: "请求不是有效JSON。" }, 400);
    if (error instanceof Error && error.message === "请求内容过大。")
      return json({ error: "请求内容过大。" }, 413);
    return json({ error: "账号服务暂时不可用，操作未完成，请稍后重试。" }, 503);
  }
}
