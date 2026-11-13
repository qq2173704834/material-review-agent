import { sessionAccount } from "./account-auth";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const usersSchema = z
  .array(
    z
      .object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), token: z.string().min(32).max(256) })
      .strict(),
  )
  .min(1)
  .max(20);
export function isLegacyTestMode(): boolean {
  return (
    process.env.REVIEW_AUTH_MODE === "legacy-test" &&
    /(?:^|[\\/])(?:e2e|model-e2e|access-e2e)$/.test(process.env.REVIEW_DATA_DIR ?? "")
  );
}
export function accessUsers(): Array<{ id: string; token: string }> {
  const raw = process.env.REVIEW_ACCESS_USERS?.trim();
  if (!raw) return [];
  let users: z.infer<typeof usersSchema>;
  try {
    users = usersSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("本地访问身份配置无效，请检查 REVIEW_ACCESS_USERS 格式、身份及凭据长度。");
  }
  if (
    new Set(users.map((user) => user.id)).size !== users.length ||
    new Set(users.map((user) => user.token)).size !== users.length
  )
    throw new Error("访问身份配置重复。");
  return users;
}
export function defaultOwner(): string {
  return isLegacyTestMode() ? (accessUsers()[0]?.id ?? "local") : "legacy-unassigned";
}
export function identityForToken(token: string): string | undefined {
  const digest = createHash("sha256").update(token).digest();
  return accessUsers().find((user) =>
    timingSafeEqual(digest, createHash("sha256").update(user.token).digest()),
  )?.id;
}
export function requestIdentity(request: Request): string | undefined {
  if (!isLegacyTestMode()) return sessionAccount(request)?.id;
  if (!accessUsers().length) return "local";
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.{1,256})$/)?.[1];
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("review_access="))
    ?.slice("review_access=".length);
  return identityForToken(bearer ?? cookie ?? "");
}
