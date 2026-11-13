import { NextResponse } from "next/server";
import { accessUsers, identityForToken, requestIdentity } from "@/lib/server/access-config";
const attempts: number[] = [];
export async function POST(request: Request): Promise<NextResponse> {
  const now = Date.now();
  while (attempts[0] && attempts[0] < now - 60_000) attempts.shift();
  if (attempts.length >= 30)
    return NextResponse.json({ error: "尝试过于频繁，请一分钟后重试。" }, { status: 429 });
  attempts.push(now);
  const body: unknown = await request.json().catch(() => null);
  const token =
    body &&
    typeof body === "object" &&
    "token" in body &&
    typeof body.token === "string" &&
    body.token.length <= 256
      ? body.token
      : "";
  const identity = identityForToken(token);
  if (!identity) return NextResponse.json({ error: "访问凭据无效。" }, { status: 401 });
  const response = NextResponse.json({ identity });
  response.cookies.set("review_access", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 8 * 3600,
  });
  return response;
}
export function GET(request: Request): NextResponse {
  return NextResponse.json({
    enabled: accessUsers().length > 0,
    identity: requestIdentity(request),
  });
}
export function DELETE(): NextResponse {
  const response = NextResponse.json({ loggedOut: true });
  response.cookies.set("review_access", "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
