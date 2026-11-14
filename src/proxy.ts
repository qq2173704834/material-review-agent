import { requestOrigin } from "@/lib/public-origin";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { accessUsers, isLegacyTestMode, requestIdentity } from "@/lib/server/access-config";
import { sessionAccount } from "@/lib/server/account-auth";
import { consumeRate } from "@/lib/server/platform-db";
import { getReviewStore } from "@/lib/server/review-store";

export function proxy(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;
  try {
    const expectedOrigin = requestOrigin(request);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== expectedOrigin)
        return NextResponse.json({ error: "拒绝跨站写入。" }, { status: 403 });
    }
    const legacy = isLegacyTestMode();
    if (legacy && ["/access", "/api/access", "/api/health"].includes(path))
      return NextResponse.next();
    if (
      !legacy &&
      (path === "/welcome" ||
        path === "/login" ||
        path === "/register" ||
        path === "/recover" ||
        path.startsWith("/api/auth/") ||
        path === "/api/health")
    )
      return NextResponse.next();
    if (legacy && !accessUsers().length) return NextResponse.next();
    const identity = requestIdentity(request);
    if (!identity) {
      if (path.startsWith("/api/"))
        return NextResponse.json(
          { error: "请先注册并登录。" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      const target = new URL(legacy ? "/access" : "/login", request.url);
      if (!legacy) target.searchParams.set("next", path + request.nextUrl.search);
      return NextResponse.redirect(target);
    }
    if (!legacy) {
      const account = sessionAccount(request);
      if (
        request.method === "GET" &&
        /\/(?:materials|package|report)(?:\/|$)/.test(path) &&
        !consumeRate(`downloads:${identity}`, 60)
      )
        return NextResponse.json({ error: "下载过于频繁，请稍后重试。" }, { status: 429 });
      if (
        (path.startsWith("/admin") ||
          path.startsWith("/api/admin/") ||
          path === "/setup" ||
          path === "/api/model/test") &&
        account?.role !== "admin"
      )
        return NextResponse.json({ error: "仅内容管理员可操作。" }, { status: 403 });
      if (path === "/api/access" || path === "/access")
        return path.startsWith("/api/")
          ? NextResponse.json({ error: "旧凭据入口已关闭，请使用账号登录。" }, { status: 410 })
          : NextResponse.redirect(new URL("/account", request.url));
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        !consumeRate(`writes:${identity}`, 120)
      )
        return NextResponse.json(
          { error: "操作频繁，请稍后重试，已有内容保留。" },
          { status: 429 },
        );
    }
    const match = decodeURIComponent(path).match(/^\/(?:api\/)?tasks\/([0-9a-f-]{36})(?:\/|$)/i);
    if (match && !getReviewStore().canAccessTask(match[1]!, identity))
      return path.startsWith("/api/")
        ? NextResponse.json({ error: "没有找到该任务。" }, { status: 404 })
        : new NextResponse("没有找到该任务。", { status: 404 });
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "身份服务不可用，请稍后重试。" }, { status: 503 });
  }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
