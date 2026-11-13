import Database from "better-sqlite3";
import { resolve } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const directory = resolve(option("data-dir") ?? ".local-data");
const platformPath = resolve(directory, "platform.sqlite");
if (!existsSync(platformPath))
  throw new Error("账号数据库尚未创建，请先启动本站并注册账号。不会自动创建管理员或修改旧数据。");
const db = new Database(platformPath, { fileMustExist: true });
db.pragma("foreign_keys=ON");
db.pragma("busy_timeout=5000");
const command = args[0];
const apply = args.includes("--apply");
try {
  if (command === "accounts") {
    console.log(
      db
        .prepare(
          "SELECT username,nickname,role,disabled,created_at FROM accounts ORDER BY created_at",
        )
        .all(),
    );
  } else if (command === "role" || command === "disable" || command === "enable") {
    const account = db
      .prepare("SELECT id,username,role,disabled FROM accounts WHERE username=?")
      .get((option("username") ?? "").toLowerCase());
    if (!account) throw new Error("账号不存在。");
    const role = option("role");
    if (command === "role" && !["admin", "user"].includes(role))
      throw new Error("请指定 --role admin 或 user");
    console.log({ command, username: account.username, role: role ?? account.role, apply });
    if (apply)
      db.transaction(() => {
        if (command === "role")
          db.prepare("UPDATE accounts SET role=? WHERE id=?").run(role, account.id);
        else
          db.prepare("UPDATE accounts SET disabled=? WHERE id=?").run(
            command === "disable" ? 1 : 0,
            account.id,
          );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(account.id);
        db.prepare("INSERT INTO security_events(user_id,action,created_at) VALUES (?,?,?)").run(
          account.id,
          `local-admin:${command}`,
          new Date().toISOString(),
        );
      })();
  } else if (command === "migrate") {
    const target = db
      .prepare("SELECT id,username FROM accounts WHERE username=? AND disabled=0")
      .get((option("to") ?? "").toLowerCase());
    const from = option("from");
    if (!target || !from) throw new Error("需指定 --from 旧所有者ID --to 新用户名（必须已注册）。");
    const reviews = new Database(resolve(directory, "reviews.sqlite"), { fileMustExist: true });
    reviews.pragma("busy_timeout=5000");
    try {
      const tasks = reviews.prepare("SELECT id,name FROM review_tasks WHERE owner_id=?").all(from);
      const grants = reviews.prepare("SELECT task_id FROM task_grants WHERE user_id=?").all(from);
      const manifest = { from, to: target.username, targetId: target.id, tasks, grants, apply };
      console.log(JSON.stringify(manifest, null, 2));
      if (apply) {
        const backupDirectory = resolve(
          directory,
          "backups",
          `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
        );
        mkdirSync(backupDirectory, { recursive: true });
        await reviews.backup(resolve(backupDirectory, "reviews.sqlite"));
        await db.backup(resolve(backupDirectory, "platform.sqlite"));
        writeFileSync(
          resolve(backupDirectory, "migration.json"),
          JSON.stringify(manifest, null, 2),
        );
        reviews.transaction(() => {
          reviews
            .prepare("UPDATE review_tasks SET owner_id=? WHERE owner_id=?")
            .run(target.id, from);
          reviews
            .prepare(
              "INSERT OR IGNORE INTO task_grants(task_id,user_id) SELECT task_id,? FROM task_grants WHERE user_id=?",
            )
            .run(target.id, from);
          reviews.prepare("DELETE FROM task_grants WHERE user_id=?").run(from);
        })();
        console.log(`迁移完成。备份：${backupDirectory}。其他未映射身份仍隔离。`);
      }
    } finally {
      reviews.close();
    }
  } else if (command === "backup") {
    const destination = resolve(
      directory,
      "backups",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    );
    mkdirSync(destination, { recursive: true });
    await db.backup(resolve(destination, "platform.sqlite"));
    const reviewPath = resolve(directory, "reviews.sqlite");
    if (existsSync(reviewPath)) {
      const reviews = new Database(reviewPath, { fileMustExist: true });
      try {
        await reviews.backup(resolve(destination, "reviews.sqlite"));
      } finally {
        reviews.close();
      }
    }
    console.log(`数据库备份：${destination}。材料原件请在停止服务后同时备份 materials/。`);
  } else {
    throw new Error(
      "用法：accounts | role --username 用户名 --role admin|user [--apply] | disable|enable --username 用户名 [--apply] | migrate --from 旧ID --to 用户名 [--apply] | backup；可追加 --data-dir 隔离目录。",
    );
  }
} finally {
  db.close();
}
