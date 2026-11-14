import { ContentFeedback } from "@/components/content-feedback";
import Link from "next/link";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { learningEntry, withdrawnLearningEntry } from "@/lib/server/learning-store";
import type { ReactElement } from "react";
export const dynamic = "force-dynamic";
export default async function Detail({
  params,
}: {
  params: Promise<{ contentId: string }>;
}): Promise<ReactElement> {
  const { contentId } = await params,
    entry = learningEntry(contentId) ?? withdrawnLearningEntry(contentId);
  if (!entry) notFound();
  const content = entry.content;
  return (
    <AppShell activePage="learn">
      <article className="space-y-5">
        <Link href="/learn" className="underline">
          返回学习资源
        </Link>
        {entry.status === "withdrawn" && (
          <p role="status" className="rounded border p-4">
            该资料已撤回，不再参与推荐或助手当前知识检索。下方保留之前发布的版本以便核对，请勿据此判断当前安排。
          </p>
        )}
        <h1 className="text-3xl font-semibold">{content.title}</h1>
        <p>
          {content.author} · v{entry.version} · {content.checkedAt}核查 · {content.disposition}
        </p>
        <p>{content.scope}</p>
        <p>
          {CATEGORY_LABELS[content.category]} · {content.region} ·{" "}
          {content.edition || "通用版本，具体考期待核对"} · {content.subject || "通用科目"} ·{" "}
          {content.studyStage}阶段
        </p>
        <p>
          形式：{content.format} · {content.language} · {content.fee} · 使用方式：
          {content.permission}
        </p>
        <p className="whitespace-pre-wrap rounded border p-5">{content.text}</p>
        <a
          className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground"
          href={content.url}
          target="_blank"
          rel="noreferrer"
        >
          前往原始来源
        </a>
        <p className="text-sm text-muted-foreground">
          本站不代报名，不提供未经授权的下载；学习建议不替代官方要求。
        </p>
        <ContentFeedback id={entry.id} />
        {content.kind === "school" && entry.status !== "withdrawn" && (
          <Link
            className="inline-block rounded border px-4 py-2"
            href={`/tasks/new?reference=${entry.id}`}
          >
            以原始高校细则建立通用材料审查任务
          </Link>
        )}
      </article>
    </AppShell>
  );
}
