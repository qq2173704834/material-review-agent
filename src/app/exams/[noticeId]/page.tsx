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
import { CATEGORY_LABELS, TIMELINE_LABELS } from "@/domain/exam-catalog";
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
                  {entry.content.title} · v{entry.version}
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
              适用考试：
              {[...new Set([content.category, ...(content.categories ?? [])])]
                .map((id) => CATEGORY_LABELS[id])
                .join("、")}{" "}
              · 等级：{content.levels?.join("、") || "未单独确认"} · 科目：
              {content.subjects?.join("、") || "未单独确认"} · 语种：
              {content.languages?.join("、") || "未单独确认"} · 形式：
              {content.examForms?.join("、") || "未单独确认"}
            </p>
          ) : null}
          <p>
            {content.organizer} · 发布：{content.publishedAt || "待核实"} · 公告v{item.version}
          </p>
          <ExamStatus
            disposition={content.disposition}
            timeline={content.timeline}
            stage={content.stage}
            initialNow={now}
          />
          <RegistrationDeadline
            disposition={content.disposition}
            timeline={content.timeline}
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
        <ExamActions id={item.id} saved={saved} />
        <section>
          <h2 className="mb-3 text-xl font-semibold">考试安排 · 北京时间</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {TIMELINE_LABELS.map((label) => {
              const point = content.timeline.find((p) => p.label === label);
              return (
                <div key={label} className="rounded border p-4">
                  <h3 className="font-medium">{label}</h3>
                  <p>
                    {point?.value || "待公布"}
                    {point?.value.length === 10 ? "（仅日期，具体时刻未公布）" : ""}
                  </p>
                  {point?.quote && (
                    <blockquote className="mt-2 border-l-2 pl-3 text-sm text-muted-foreground">
                      {point.quote}
                    </blockquote>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">整理摘要与适用人群</h2>
          <p className="whitespace-pre-wrap">{content.summary || "未提供摘要，请阅读下方原文。"}</p>
          <p className="whitespace-pre-wrap">
            {content.audience || "资格条件尚未整理，不能据此判断个人是否符合。"}
          </p>
          <p className="text-sm text-muted-foreground">
            摘要为本站整理，最终以官方原文及具体岗位/科目条件为准。
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">官方附件</h2>
          {content.attachments.length ? (
            content.attachments.map((a) => (
              <p key={a.url}>
                <a className="text-primary underline" href={a.url} target="_blank" rel="noreferrer">
                  {a.name}
                </a>{" "}
                · {a.status}
              </p>
            ))
          ) : (
            <p>本次未收录附件，请到官方原文核对。</p>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold">
            {content.textScope === "摘录" ? "原文摘录（非全文）" : "原文快照"}
          </h2>
          {content.textScope === "摘录" && (
            <p className="mb-3 text-sm text-muted-foreground">
              以下为原文摘录，完整内容请查看官方原文。
            </p>
          )}
          <pre className="max-h-[800px] overflow-auto rounded border p-5 font-sans text-sm leading-7 whitespace-pre-wrap">
            {content.text}
          </pre>
        </section>
        <details className="rounded border p-4">
          <summary>历史版本与更正</summary>
          {history.map((v) => (
            <div className="my-3" key={v.version}>
              <p>
                v{v.version} · 保存于{v.created_at} · {v.content.title}
              </p>
              <pre className="max-h-60 overflow-auto text-sm whitespace-pre-wrap">
                {v.content.text}
              </pre>
            </div>
          ))}
        </details>
        {content.relatedId && (
          <Link href={`/exams/${content.relatedId}`} className="text-primary underline">
            查看关联原公告 / 更正公告
          </Link>
        )}
      </article>
    </AppShell>
  );
}
