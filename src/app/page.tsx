import {
  ArrowRight,
  FileCheck2,
  FileSearch,
  Files,
  FolderOpen,
  ListChecks,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { ReactElement } from "react";

const workflowSteps = [
  { title: "导入要求", description: "从本次通知中整理提交规范", icon: FileSearch },
  { title: "匹配材料", description: "将文件与独立检查项关联", icon: Files },
  { title: "逐项核验", description: "查看结论、原文与材料证据", icon: ListChecks },
  { title: "整改复检", description: "更新材料，确认问题的变化", icon: RefreshCw },
];

export default function TasksPage(): ReactElement {
  return (
    <AppShell activePage="tasks">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="h-px w-5 bg-primary" /> 审查工作空间
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">我的审查任务</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            把复杂的提交要求，变成有依据、可追踪的逐项核验。
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button disabled aria-describedby="create-task-note">
            <Plus aria-hidden="true" />
            新建审查任务
          </Button>
          <p id="create-task-note" className="text-xs text-muted-foreground">
            任务创建将在下一功能批次开放
          </p>
        </div>
      </div>

      <section
        aria-labelledby="task-list-heading"
        className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_24px_-16px_#24324a30]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
          <h2 id="task-list-heading" className="flex items-center gap-2 text-sm font-semibold">
            全部任务{" "}
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
              0
            </span>
          </h2>
          <Badge>尚未创建任务</Badge>
        </div>
        <div className="flex flex-col items-center px-5 py-14 text-center sm:py-20">
          <div className="relative mb-8 flex size-28 items-center justify-center rounded-full bg-primary/5">
            <span className="absolute inset-2 rounded-full border border-dashed border-primary/20" />
            <div className="relative -rotate-6 rounded-xl border border-primary/15 bg-white p-5 shadow-[0_8px_24px_-12px_#5b57d660]">
              <FolderOpen className="size-10 text-primary" strokeWidth={1.4} aria-hidden="true" />
            </div>
            <span className="absolute right-0 bottom-1 rounded-lg border border-border bg-white p-2 text-primary">
              <FileCheck2 className="size-5" aria-hidden="true" />
            </span>
          </div>
          <h3 className="text-xl font-semibold tracking-tight">从一份通知，开启一次清晰的审查</h3>
          <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">
            在这里管理通知、材料、检查结论与整改记录。
            <br className="hidden sm:block" />
            当前工程已进入初始化阶段，审查功能将按批次接入。
          </p>
          <Button asChild variant="outline" className="mt-7">
            <Link href="/setup">
              查看初始化状态 <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">没有预置任务或演示结论</p>
        </div>
      </section>

      <section id="workflow" aria-labelledby="workflow-heading" className="mt-10">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 id="workflow-heading" className="text-sm font-semibold">
            从要求到复检，每一步都有记录
          </h2>
          <span className="text-xs text-muted-foreground">流程规划</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {workflowSteps.map(({ title, description, icon: Icon }, index) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5">
              <div className="mb-5 flex items-center justify-between">
                <Icon className="size-5 text-primary" strokeWidth={1.6} aria-hidden="true" />
                <span className="font-mono text-xs text-muted-foreground/60">0{index + 1}</span>
              </div>
              <h3 className="text-sm font-medium">{title}</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>
      <p className="mt-8 text-xs leading-6 text-muted-foreground">
        预审应区分通过、未通过、待确认、无法检查与不适用。未核验的内容不会被表示为通过。
      </p>
    </AppShell>
  );
}
