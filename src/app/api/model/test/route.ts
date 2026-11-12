import { NextResponse } from "next/server";
import { z } from "zod";

import { generateModelJson, modelErrorResponse } from "@/lib/server/model-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { call } = await generateModelJson({
      schema: z.object({ ok: z.literal(true) }),
      operation: "connection_test",
      system: '执行连接测试。只输出JSON：{"ok":true}。',
      prompt: "请返回连接测试 JSON。",
      signal: request.signal,
      maxOutputTokens: 128,
    });
    return NextResponse.json(
      { message: "连接成功，已收到真实模型响应。", call },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = modelErrorResponse(error);
    return NextResponse.json(
      { error: failure.error, code: failure.code },
      { status: failure.status },
    );
  }
}
