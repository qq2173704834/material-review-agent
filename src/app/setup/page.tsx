import { ArrowLeft, CheckCircle2, CircleDashed, ExternalLink, FlaskConical } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRuntimeStatus } from "@/lib/server/runtime-status";
import { getReviewStore } from "@/lib/server/review-store";
import { ModelConnectionTest } from "@/components/model-connection-test";

import type { Metadata } from "next";
import type { ReactElement } from "react";

export const metadata: Metadata = { title: "本地环境" };
export const dynamic = "force-dynamic";

const initializedItems = [
  "Next.js App Router 与严格 TypeScript",
  "Tailwind CSS 与 shadcn/ui 基础组件",
  "SQLite 本地任务、通知版本与来源位置存储",
  "多格式材料解析、规格检查与逐项进度",
  "真实模型规则提取与材料证据审查",
  "材料版本失效、复检对比与 Markdown 报告",
  "服务端环境状态与健康检查",
  "代码检查、格式化与 Playwright 测试入口",
];
const pendingItems = [
  "图像 OCR 与复杂扫描件识别",
  "网页来源、跨材料一致性与规则冲突增强",
  "多人账号、访问权限与公网部署",
];

export default function SetupPage(): ReactElement {
  const taskCount = getReviewStore().listTasks().length;
  const runtimeStatus = getRuntimeStatus(true);
  const modeLabel =
    runtimeStatus.mode === "invalid"
      ? "配置无效"
      : runtimeStatus.mode === "mock"
        ? "模拟开发模式"
        : "真实服务配置模式";

  return (
    <AppShell activePage="setup">
      <Badge className="mb-4">本地工作台 · ENG-005 / ENG-008—ENG-010</Badge>
      <h1 className="text-2xl font-semibold sm:text-3xl">本地环境与开发状态</h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
        在这里检查模型配置与连接。真实服务由你手动触发调用，配置完整不等于连接已经成功。
      </p>
      <section
        aria-labelledby="mode-heading"
        className="mt-8 flex flex-col gap-4 rounded-2xl border border-primary/15 bg-primary/5 p-6 sm:flex-row"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary">
          <FlaskConical className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="mode-heading" className="text-base font-semibold">
            {modeLabel}
          </h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {runtimeStatus.mode === "live"
              ? "真实模式下，生成规则会发送通知原文，运行语义审查会发送相关材料片段到你配置的模型服务。"
              : "模拟模式下不调用外部模型；确定性工具仍读取实际文件属性。"}
            {runtimeStatus.hasModelConfiguration
              ? "已检测到完整模型配置，可在下方手动测试连接。"
              : "尚未检测到有效的完整模型配置。"}
          </p>
        </div>
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section
          aria-labelledby="initialized-heading"
          className="rounded-2xl border border-border bg-card p-6"
        >
          <h2 id="initialized-heading" className="font-semibold">
            当前能力
          </h2>
          <ul className="mt-6 space-y-5">
            {initializedItems.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6">
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        </section>
        <section
          aria-labelledby="pending-heading"
          className="rounded-2xl border border-border bg-card p-6"
        >
          <h2 id="pending-heading" className="font-semibold">
            后续功能，尚未实现
          </h2>
          <ul className="mt-6 space-y-5">
            {pendingItems.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section
        aria-labelledby="configuration-heading"
        className="mt-6 rounded-2xl border border-border bg-card p-6"
      >
        <h2 id="configuration-heading" className="font-semibold">
          模型 API 配置
        </h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          任务与通知原文保存在项目本地数据目录中，当前共保存 {taskCount} 个任务。密钥只保存在根目录
          .env.local，服务端读取，不会显示或回传密钥。修改配置后重启 pnpm dev，再刷新本页。
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-muted p-4 text-xs leading-7">{`AI_MODE=live\nAI_PROVIDER=deepseek\nAI_BASE_URL=https://api.deepseek.com\nAI_MODEL=deepseek-flash\nAI_API_KEY=在本地填入你的密钥`}</pre>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          地址填写 API 根地址，不要填写 /chat/completions；模型 ID
          以服务商控制台为准。默认每个审查最多 12
          个模型步骤、每步最多一次重试；未知费用以服务商账单为准。
        </p>
        <ModelConnectionTest
          canTest={runtimeStatus.mode === "live" && runtimeStatus.hasModelConfiguration}
        />
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="outline" size="sm">
            <a href="/api/health" target="_blank" rel="noreferrer">
              查看健康检查 <ExternalLink aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              返回任务列表
            </Link>
          </Button>
        </div>
      </section>
    </AppShell>
  );
}
