import { ArrowLeft, CheckCircle2, CircleDashed, ExternalLink, FlaskConical } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRuntimeStatus } from "@/lib/server/runtime-status";
import { getReviewStore } from "@/lib/server/review-store";

import type { Metadata } from "next";
import type { ReactElement } from "react";

export const metadata: Metadata = { title: "本地环境" };
export const dynamic = "force-dynamic";

const initializedItems = [
  "Next.js App Router 与严格 TypeScript",
  "Tailwind CSS 与 shadcn/ui 基础组件",
  "SQLite 本地任务、通知版本与来源位置存储",
  "服务端环境状态与健康检查",
  "代码检查、格式化与 Playwright 测试入口",
];
const pendingItems = [
  "动态规则提取与免费模型接口联调",
  "常见文档、表格与图片材料解析和匹配",
  "规格检查、证据、复检与报告导出",
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
      <Badge className="mb-4">开发环境 · ENG-002 / ENG-004</Badge>
      <h1 className="text-2xl font-semibold sm:text-3xl">本地环境与开发状态</h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
        这里展示初始化基础与尚未接入的能力。配置模式和真实联调状态分别记录。
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
            当前未实现模型调用，也不会自动发送通知或材料。
            {runtimeStatus.hasModelConfiguration
              ? "已检测到模型配置，仍需后续接入和实际验证。"
              : "尚未提供完整模型配置。"}
            免费接口的真实联调结果将与模拟测试分别标注。
          </p>
        </div>
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section
          aria-labelledby="initialized-heading"
          className="rounded-2xl border border-border bg-card p-6"
        >
          <h2 id="initialized-heading" className="font-semibold">
            初始化基础
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
          模型配置准备
        </h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          任务与通知原文保存在项目本地数据目录中，当前共保存 {taskCount}{" "}
          个任务；单机数据没有账户或多人访问隔离。将根目录 .env.example 复制为
          .env.local，未来在本地填写服务地址、模型名与密钥。密钥只由服务端读取；填写配置不代表已完成真实接入。
        </p>
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
