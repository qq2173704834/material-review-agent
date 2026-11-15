import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { examImportOptions, examImportPreview, createImportedTask } from "@/lib/server/exam-import";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function GET(request: Request): NextResponse {
  const account = sessionAccount(request);
  if (!account) return json({ error: "请先登录。" }, 401);
  try {
    const params = new URL(request.url).searchParams;
    return params.has("selection")
      ? json({
          preview: examImportPreview(
            account.id,
            params.get("selection") ?? "",
            params.get("notice") ?? "",
          ),
        })
      : json({ options: examImportOptions(account.id) });
  } catch {
    return json({ error: "考试或公告不可用，请重新选择。" }, 404);
  }
}
export async function POST(request: Request): Promise<NextResponse> {
  const account = sessionAccount(request);
  if (!account) return json({ error: "请先登录。" }, 401);
  try {
    return json(createImportedTask(account.id, await readSmallJson(request, 16000)), 201);
  } catch (error) {
    return json(
      {
        error:
          error instanceof ZodError
            ? "输入格式不正确，请重新选择。"
            : error instanceof Error
              ? error.message
              : "导入失败，请重试。",
      },
      400,
    );
  }
}
