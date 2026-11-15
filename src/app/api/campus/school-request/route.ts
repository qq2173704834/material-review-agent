import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
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
          .string()
          .trim()
          .max(2000)
          .refine((value) => {
            if (!value) return true;
            try {
              const url = new URL(value);
              return url.protocol === "https:" && !url.username && !url.password && !url.port;
            } catch {
              return false;
            }
          })
          .default(""),
      })
      .strict()
      .parse(await readSmallJson(request));
    const db = campusDb();
    db.transaction(() => {
      const requests = db
        .prepare<[string], { request_key: string; name: string; url: string }>(
          "SELECT request_key,name,url FROM campus_school_requests_v2 WHERE user_id=?",
        )
        .all(user.id);
      const normalize = (name: string): string =>
        name.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
      const prior = requests.find(
        (item) =>
          normalize(item.name) === normalize(input.name) || (input.url && item.url === input.url),
      );
      if (prior) {
        if (!prior.url && input.url)
          db.prepare(
            "UPDATE campus_school_requests_v2 SET url=? WHERE user_id=? AND request_key=?",
          ).run(input.url, user.id, prior.request_key);
        return;
      }
      if (requests.length >= 10) throw new Error("已申请添加10所学校，请等待处理。");
      db.prepare(
        "INSERT INTO campus_school_requests_v2(user_id,request_key,url,name,created_at) VALUES (?,?,?,?,?)",
      ).run(user.id, randomUUID(), input.url, input.name, new Date().toISOString());
    })();
    return NextResponse.json({
      message: "学校添加申请已提交，维护人员会核对并补充通知来源。你可以先使用个人日程。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && !error.name.includes("Zod")
            ? error.message
            : "请填写至少2个字的学校名称；官网可留空，填写时请使用完整的HTTPS地址。",
      },
      { status: 400 },
    );
  }
}
