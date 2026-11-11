import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { TaskEditor } from "@/components/task-editor";
import { Button } from "@/components/ui/button";

import type { Metadata } from "next";
import type { ReactElement } from "react";

export const metadata: Metadata = { title: "新建审查任务" };

export default function NewTaskPage(): ReactElement {
  return (
    <AppShell activePage="task-detail">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-3">
        <Link href="/">
          <ArrowLeft aria-hidden="true" />
          返回任务列表
        </Link>
      </Button>
      <div className="mb-8">
        <p className="text-xs font-medium text-primary">ENG-004 · 本地任务</p>
        <h1 className="mt-2 text-2xl font-semibold">新建审查任务</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          粘贴本次项目通知或要求原文，保存后可随时回来继续整理。
        </p>
      </div>
      <TaskEditor />
    </AppShell>
  );
}
