import "server-only";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { platformDb, securityEvent } from "./platform-db";

export interface Account {
  id: string;
  username: string;
  nickname: string;
  role: "user" | "admin";
  disabled: number;
}
interface AccountRow extends Account {
  password_hash: string;
}
export const SESSION_COOKIE = "exam_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}
async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function checkPassword(password: string, hash: string): Promise<boolean> {
  const [version, salt, encoded] = hash.split("$");
  if (version !== "scrypt-v1" || !salt || !encoded || encoded.length !== 128) return false;
  const actual = await derive(password, salt);
  const expected = Buffer.from(encoded, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export function accountByUsername(username: string): AccountRow | undefined {
  return platformDb()
    .prepare<[string], AccountRow>("SELECT * FROM accounts WHERE username=?")
    .get(normalizeUsername(username));
}
export function accountById(id: string): Account | undefined {
  return platformDb()
    .prepare<[string], Account>(
      "SELECT id,username,nickname,role,disabled FROM accounts WHERE id=?",
    )
    .get(id);
}
export function publicAccount(account: Account): Omit<Account, "disabled"> {
  return {
    id: account.id,
    username: account.username,
    nickname: account.nickname,
    role: account.role,
  };
}
function newRecoveryCodes(userId: string): string[] {
  const db = platformDb();
  db.prepare("DELETE FROM recovery_codes WHERE user_id=?").run(userId);
  return Array.from({ length: 8 }, () => {
    const code = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO recovery_codes(digest,user_id) VALUES (?,?)").run(digest(code), userId);
    return code;
  });
}
export async function registerAccount(
  username: string,
  password: string,
  nickname: string,
): Promise<{ account: Account; codes: string[] }> {
  const passwordHash = await hashPassword(password);
  const db = platformDb();
  const id = randomUUID();
  return db.transaction(() => {
    db.prepare(
      "INSERT INTO accounts(id,username,nickname,password_hash,created_at) VALUES (?,?,?,?,?)",
    ).run(
      id,
      normalizeUsername(username),
      nickname || username,
      passwordHash,
      new Date().toISOString(),
    );
    const codes = newRecoveryCodes(id);
    securityEvent(id, "registered");
    return { account: accountById(id)!, codes };
  })();
}
export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const db = platformDb();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions(digest,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(
    digest(token),
    userId,
    Date.now() + SESSION_SECONDS * 1000,
    Date.now(),
  );
  db.prepare(
    "DELETE FROM sessions WHERE user_id=? AND digest NOT IN (SELECT digest FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 20)",
  ).run(userId, userId);
  return token;
}
export function tokenFromRequest(request: Request): string {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1) ?? ""
  );
}
export function sessionAccount(request: Request): Account | undefined {
  const token = tokenFromRequest(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  return platformDb()
    .prepare<[string, number], Account>(
      `SELECT a.id,a.username,a.nickname,a.role,a.disabled FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.digest=? AND s.expires_at>? AND a.disabled=0`,
    )
    .get(digest(token), Date.now());
}
export function revokeSession(request: Request): void {
  platformDb()
    .prepare("DELETE FROM sessions WHERE digest=?")
    .run(digest(tokenFromRequest(request)));
}
export function revokeAll(userId: string): void {
  platformDb().prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
}
export async function resetPassword(
  username: string,
  recoveryCode: string,
  password: string,
): Promise<string[] | undefined> {
  const account = accountByUsername(username);
  if (!account || account.disabled) return undefined;
  const nextHash = await hashPassword(password);
  const db = platformDb();
  return db.transaction(() => {
    const valid = db
      .prepare("SELECT 1 FROM recovery_codes WHERE digest=? AND user_id=?")
      .get(digest(recoveryCode), account.id);
    if (!valid) return undefined;
    db.prepare("UPDATE accounts SET password_hash=? WHERE id=?").run(nextHash, account.id);
    revokeAll(account.id);
    const codes = newRecoveryCodes(account.id);
    securityEvent(account.id, "password-reset");
    return codes;
  })();
}
export async function changePassword(
  account: Account,
  oldPassword: string,
  password: string,
): Promise<string[] | undefined> {
  const row = accountByUsername(account.username);
  if (!row || !(await checkPassword(oldPassword, row.password_hash))) return undefined;
  const nextHash = await hashPassword(password);
  const db = platformDb();
  return db.transaction(() => {
    if (
      !db
        .prepare(
          "UPDATE accounts SET password_hash=? WHERE id=? AND password_hash=? AND disabled=0",
        )
        .run(nextHash, account.id, row.password_hash).changes
    )
      return undefined;
    revokeAll(account.id);
    const codes = newRecoveryCodes(account.id);
    securityEvent(account.id, "password-changed");
    return codes;
  })();
}
