import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { TaskEditor } from "@/components/task-editor";
import { Button } from "@/components/ui/button";
import { learningEntry } from "@/lib/server/learning-store";

import type { Metadata } from "next";
import type { ReactElement } from "react";

export const metadata: Metadata = { title: "新建审查任务" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const filters = await searchParams;
  const reference = filters.reference ? learningEntry(filters.reference) : undefined;
  const school = reference?.content.kind === "school" ? reference : undefined;
  return (
    <AppShell activePage="task-detail">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-3">
        <Link href={school ? `/learn/${school.id}` : "/tasks"}>
          <ArrowLeft aria-hidden="true" />
          {school ? "返回高校参考" : "返回任务列表"}
        </Link>
      </Button>
      <div className="mb-8">
        <p className="text-xs font-medium text-primary">考试材料自查</p>
        <h1 className="mt-2 text-2xl font-semibold">新建审查任务</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          提交前，检查材料是否齐全、格式是否符合要求，及时发现需要补充或修改的地方。先选择考试要求或导入原文，再上传材料开始自查。
        </p>
      </div>
      {filters.reference && (
        <p className="mb-5 rounded border p-4">
          {school
            ? `已带入${school.content.title}的原始网页。保存时将重新读取公开原文；目录摘录不作为全文，适用学校和版本仍需核对，不生成全国加分结论。`
            : "参考内容不存在、未发布或并非高校细则，请自行选择原始要求。"}
        </p>
      )}
      <TaskEditor
        initialSource={school ? { name: school.content.title, url: school.content.url } : undefined}
      />
    </AppShell>
  );
}
