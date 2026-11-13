import { spawn } from "node:child_process";
import { existsSync, mkdirSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (process.env.REVIEW_AUTH_MODE !== "accounts")
  throw new Error("部署入口必须显式REVIEW_AUTH_MODE=accounts，禁止测试身份旁路。");
const origin = new URL(process.env.APP_PUBLIC_ORIGIN ?? "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("需配置HTTPS APP_PUBLIC_ORIGIN。");
if (!existsSync(resolve(".next/BUILD_ID"))) throw new Error("请先完成生产构建。");
if (!/^24\./.test(process.versions.node)) throw new Error("需使用锁定的Node24主版本。");
const data = resolve(process.env.REVIEW_DATA_DIR ?? ".local-data");
mkdirSync(data, { recursive: true, mode: 0o700 });
accessSync(data, constants.R_OK | constants.W_OK);
for (const tool of [process.env.FFMPEG_PATH, process.env.FFPROBE_PATH])
  if (!tool || !existsSync(tool))
    throw new Error("部署环境需显式配置可用的FFMPEG_PATH与FFPROBE_PATH。");
for (const code of ["eng", "chi_sim"])
  if (
    !existsSync(
      resolve("node_modules/@tesseract.js-data", code, "4.0.0_best_int", `${code}.traineddata.gz`),
    )
  )
    throw new Error("本地OCR语言数据缺失。");
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    process.env.DEPLOY_HOST ?? "127.0.0.1",
    "--port",
    process.env.PORT ?? "3000",
  ],
  { stdio: "inherit", env: { ...process.env, NODE_ENV: "production", REVIEW_DATA_DIR: data } },
);
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
