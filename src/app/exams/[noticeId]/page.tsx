import {
  examTimeline,
  reviewedExamDates,
  formatExamPoint,
  missingExamTimeLabel,
} from "@/lib/exam-timeline";
import { BrowseBack } from "@/components/browse-back";
import { safeBrowseReturn } from "@/lib/browse-return";
import type { ReactElement } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ExamStatus, RegistrationDeadline } from "@/components/registration-deadline";
import { requestTime } from "@/lib/server/request-time";
import { ExamActions } from "@/components/exam-actions";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { sessionAccount } from "@/lib/server/account-auth";
import { favorites, notice, publishedHistory } from "@/lib/server/exam-store";
import { examCatalogState } from "@/lib/server/catalog-state";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ noticeId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const { noticeId } = await params;
  const now = await requestTime();
  const item = notice(noticeId);
  if (!item) notFound();
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  const saved = account ? favorites(account.id).some((f) => f.id === noticeId) : false;
  const lifecycle = examCatalogState(item.content.category, item.content.region);
  const content =
    lifecycle.blocked && item.content.disposition === "正常"
      ? { ...item.content, disposition: "待核实" as const }
      : item.content;
  const timeline = examTimeline(content);
  const dateReference = reviewedExamDates(content);
  const back = safeBrowseReturn((await searchParams).returnTo, "/exams");
  const history = publishedHistory(noticeId).filter((v) => v.version <= item.version);
  return (
    <AppShell activePage="exams">
      <article className="max-w-5xl space-y-7">
        <BrowseBack href={back} label={back.startsWith("/me") ? "返回我的考试" : "返回考试中心"} />
        <header className="space-y-3">
          <p className="text-sm text-primary">
            {CATEGORY_LABELS[content.category]} · {content.region} · {content.edition} ·{" "}
            {content.stage}
          </p>
          <h1 className="text-3xl font-semibold">{content.title}</h1>
          {lifecycle.evidence.length > 0 && (
            <div className="rounded border p-3">
              <p>{lifecycle.label}；下方保留原公告历史，不据旧安排确认当前可报名。</p>
              {lifecycle.evidence.map((entry) => (
                <Link key={entry.id} className="mr-3 underline" href={`/learn/${entry.id}`}>
                  {entry.content.title}
                </Link>
              ))}
            </div>
          )}
          {content.categories?.length ||
          content.levels?.length ||
          content.subjects?.length ||
          content.languages?.length ||
          content.examForms?.length ? (
            <p className="text-sm text-muted-foreground">
              {[
                content.categories?.length
                  ? `适用考试：${[...new Set([content.category, ...content.categories])].map((id) => CATEGORY_LABELS[id]).join("、")}`
                  : "",
                content.levels?.length ? `等级：${content.levels.join("、")}` : "",
                content.subjects?.length ? `科目：${content.subjects.join("、")}` : "",
                content.languages?.length ? `语种：${content.languages.join("、")}` : "",
                content.examForms?.length ? `形式：${content.examForms.join("、")}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <p>
            {content.organizer} · 发布：{content.publishedAt || "待核实"}
          </p>
          <ExamStatus
            title={content.title}
            disposition={content.disposition}
            timeline={timeline}
            stage={content.stage}
            initialNow={now}
          />
          <RegistrationDeadline
            disposition={content.disposition}
            timeline={timeline}
            stage={content.stage}
            initialNow={now}
          />
          <a
            href={item.canonical_url}
            target="_blank"
            rel="noreferrer"
            className="block text-primary underline"
          >
            查看官方原文
          </a>
        </header>
        <Link
          className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground"
          href={`/me?newCategory=${content.category}&noticeId=${item.id}#goals`}
        >
          设为我的考试目标并准备材料
        </Link>
        <Link
          className="inline-block rounded-xl border px-4 py-2 text-primary"
          href={`/learn?category=${content.category}`}
        >
          查看该考试的学习资料 →
        </Link>
        <ExamActions id={item.id} saved={saved} />
        <section aria-label="考试日程" className="space-y-3">
          <h2 className="text-xl font-semibold">考试日程</h2>
          {timeline.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {timeline.map((point) => (
                <div key={point.label} className="rounded-xl border bg-card p-4">
                  <h3 className="text-sm text-muted-foreground">{point.label}</h3>
                  <p className="mt-2 font-medium">
                    {point.value ? formatExamPoint(point) : missingExamTimeLabel(point)}
                  </p>
                  {point.value.length === 10 && (
                    <p className="mt-1 text-xs text-muted-foreground">具体时刻见原文</p>
                  )}
                  {point.quote && (
                    <details className="mt-2 text-sm text-muted-foreground">
                      <summary>查看时间依据</summary>
                      <blockquote className="mt-2 border-l-2 pl-3 whitespace-pre-wrap">
                        {point.quote}
                      </blockquote>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
              本公告未列具体日程，可查看原文中的相关安排。
            </p>
          )}
          {dateReference && (
            <div className="text-sm text-muted-foreground">
              {dateReference.note && <p className="mb-2">{dateReference.note}</p>}
              <a
                href={dateReference.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                日程来源：{dateReference.sourceTitle} ↗
              </a>
            </div>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">公告摘要</h2>
          <p className="whitespace-pre-wrap">{content.summary || "未提供摘要，请阅读下方原文。"}</p>
          <p className="whitespace-pre-wrap">
            {content.audience || "资格条件尚未整理，不能据此判断个人是否符合。"}
          </p>
        </section>
        {content.attachments.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">相关附件</h2>
            {content.attachments.map((attachment) => (
              <a
                key={attachment.url}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="block text-primary underline"
              >
                {attachment.name} ↗
              </a>
            ))}
          </section>
        )}
        <details className="rounded-xl border p-5">
          <summary className="font-semibold">
            {content.textScope === "摘录" ? "公告摘录" : "公告正文"}
          </summary>
          <pre className="max-h-[800px] overflow-auto rounded border p-5 font-sans text-sm leading-7 whitespace-pre-wrap">
            {content.text}
          </pre>
        </details>
        {history.length > 1 && (
          <details className="rounded border p-4">
            <summary>公告更新记录</summary>
            {history.map((v) => (
              <div className="my-3" key={v.version}>
                <p>
                  更新于{v.created_at.slice(0, 10)} · {v.content.title}
                </p>
                <pre className="max-h-60 overflow-auto text-sm whitespace-pre-wrap">
                  {v.content.text}
                </pre>
              </div>
            ))}
          </details>
        )}
        {content.relatedId && (
          <Link href={`/exams/${content.relatedId}`} className="text-primary underline">
            查看关联原公告 / 更正公告
          </Link>
        )}
      </article>
    </AppShell>
  );
}
