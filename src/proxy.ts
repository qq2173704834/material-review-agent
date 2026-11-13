import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { accessUsers, requestIdentity } from "@/lib/server/access-config";
import { getReviewStore } from "@/lib/server/review-store";

export function proxy(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== `${request.nextUrl.protocol}//${request.headers.get("host")}`)
      return NextResponse.json({ error: "拒绝跨站写入。" }, { status: 403 });
  }
  if (path === "/access" || path === "/api/access" || path === "/api/health")
    return NextResponse.next();
  try {
    if (!accessUsers().length) return NextResponse.next();
    const identity = requestIdentity(request);
    if (!identity)
      return path.startsWith("/api/")
        ? NextResponse.json({ error: "请先登录本地访问身份。" }, { status: 401 })
        : NextResponse.redirect(new URL("/access", request.url));
    const match = decodeURIComponent(path).match(/^\/(?:api\/)?tasks\/([0-9a-f-]{36})(?:\/|$)/i);
    if (match && !getReviewStore().canAccessTask(match[1]!, identity))
      return path.startsWith("/api/")
        ? NextResponse.json({ error: "没有找到该任务。" }, { status: 404 })
        : new NextResponse("没有找到该任务。", { status: 404 });
    return NextResponse.next();
  } catch {
    return NextResponse.json({ error: "本地访问配置无效，请检查服务端配置。" }, { status: 503 });
  }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
