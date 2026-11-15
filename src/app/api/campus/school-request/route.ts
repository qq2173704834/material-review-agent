import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionAccount } from "@/lib/server/account-auth";
import { readSmallJson } from "@/lib/server/request-json";
import { campusDb } from "@/lib/server/campus-store";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const user = sessionAccount(request);
  if (!user) return NextResponse.json({ error: "请登录。" }, { status: 401 });
  try {
    const input = z
      .object({
        name: z.string().trim().min(2).max(100),
        url: z
          .url()
          .max(2000)
          .refine((value) => {
            const url = new URL(value);
            return url.protocol === "https:" && !url.username && !url.password && !url.port;
          }),
      })
      .strict()
      .parse(await readSmallJson(request));
    const db = campusDb();
    if (
      (db
        .prepare<[string], { n: number }>(
          "SELECT COUNT(*) n FROM campus_school_requests WHERE user_id=?",
        )
        .get(user.id)?.n || 0) >= 10
    )
      throw new Error("已提交10所学校，请等待核对。");
    db.prepare(
      "INSERT OR IGNORE INTO campus_school_requests(user_id,url,name,created_at) VALUES (?,?,?,?)",
    ).run(user.id, input.url, input.name, new Date().toISOString());
    return NextResponse.json({
      message: "已收到学校信息，核对后接入。你可以先导入通知或添加日程。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && !error.name.includes("Zod")
            ? error.message
            : "请填写学校名称及HTTPS官网地址。",
      },
      { status: 400 },
    );
  }
}
