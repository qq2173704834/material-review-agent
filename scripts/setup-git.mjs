import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { stdio: "inherit" });
console.log("已为当前仓库启用提交格式校验，不修改全局 Git 设置。");
