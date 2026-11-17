import { BrowseBack } from "@/components/browse-back";
import { safeBrowseReturn } from "@/lib/browse-return";
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
  searchParams,
}: {
  params: Promise<{ contentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const { contentId } = await params,
    entry = learningEntry(contentId) ?? withdrawnLearningEntry(contentId);
  if (!entry) notFound();
  const content = entry.content;
  const filters = await searchParams;
  const fromPrep = filters.from === "prep" && /^[0-9a-f-]{36}$/.test(filters.goal ?? "");
  const back = fromPrep
    ? `/me/preparation?goal=${filters.goal}&view=roadmap${/^[0-9a-f-]{36}$/.test(filters.stage ?? "") ? `&stage=${filters.stage}` : ""}`
    : safeBrowseReturn(filters.returnTo, "/learn");
  return (
    <AppShell activePage="learn">
      <article className="space-y-5">
        <BrowseBack
          href={back}
          label={
            fromPrep
              ? "返回备考路线"
              : back.startsWith("/me/schedule")
                ? "返回我的日程"
                : "返回学习资源"
          }
        />
        {entry.status === "withdrawn" && (
          <p role="status" className="rounded border p-4">
            该资料已撤回，当前显示归档内容。
          </p>
        )}
        <h1 className="text-3xl font-semibold">{content.title}</h1>
        <p>
          {content.author}
          {content.disposition !== "现行" ? ` · ${content.disposition}` : ""}
        </p>
        {content.sourceType === "非官方参考" && (
          <p role="note" className="rounded border border-amber-600 p-3">
            {content.url.startsWith("/")
              ? "本站原创学习材料 · AI辅助编写"
              : "非官方参考 · 查看原始来源了解适用范围。"}
          </p>
        )}
        <p>{content.scope}</p>
        {content.summary && (
          <p className="rounded border p-3 text-sm text-muted-foreground">{content.summary}</p>
        )}
        <p>
          {CATEGORY_LABELS[content.category]} · {content.region} · {content.edition || "通用资料"} ·{" "}
          {content.subject || "通用科目"} · {content.studyStage}阶段
        </p>
        <p>
          形式：{content.format} · {content.language} · {content.fee}
        </p>
        <section
          id="learning-content"
          className="rounded-2xl border bg-card p-5 text-sm leading-8 whitespace-pre-wrap"
        >
          {content.text}
        </section>
        {!content.url.startsWith("/") && (
          <a
            className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground"
            href={content.url}
            target="_blank"
            rel="noreferrer"
          >
            访问原站 ↗
          </a>
        )}
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
