import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { sessionAccount } from "@/lib/server/account-auth";
import { isLegacyTestMode } from "@/lib/server/access-config";
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

export const metadata: Metadata = { title: "服务维护" };
export const dynamic = "force-dynamic";

const initializedItems = [
  "多格式材料解析、规格检查与逐项审查进度",
  "图片与扫描 PDF 中英 OCR、逐页读取状态和人工文字纠正",
  "公开网页与关联附件导入、来源版本及原文定位",
  "明确字段的跨材料一致性与数值、日期、排他格式冲突提醒",
  "模型规则提取、材料证据、历史版本、复检与报告导出",
  "用户名密码注册登录、恢复码、会话管理与按任务授权",
  "学生考试目录、公告审核发布、收藏与公告关联预审",
];
const capabilityLimits = [
  "复杂扫描件：多栏阅读顺序、合并表格与手写识别仍需增强和样本验收；不判断签章真伪。",
  "复杂语义：隐含条件冲突、字段别名和多主体对应仍需人工核对。",
  "考试覆盖：查看已接入来源、采集状态与待审核公告。",
  "运行与上线：当前为本机单实例；公网部署、HTTPS、外置灾备和多实例运行尚未完成上线验收。",
  "效果与体验：独立业务效果评估、首次学生走查与完整辅助技术人工审计仍待完成。",
];

export default async function SetupPage(): Promise<ReactElement> {
  if (!isLegacyTestMode()) {
    const account = sessionAccount(new Request("http://local", { headers: await headers() }));
    if (account?.role !== "admin") notFound();
  }
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
      <Badge className="mb-4">本地工作台 · 功能与模型配置</Badge>
      <h1 className="text-2xl font-semibold sm:text-3xl">服务维护与模型配置</h1>
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
            当前限制与后续验收
          </h2>
          <ul className="mt-6 space-y-5">
            {capabilityLimits.map((item) => (
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
          填写API根地址及服务商提供的模型ID。默认每个审查最多12个模型步骤，每步最多一次重试；费用可在服务商控制台查看。
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
