import provincialSources from "@/domain/provincial-exam-sources.json";
import type { ReactElement } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CATEGORY_LABELS, EXAM_CATEGORIES, EXAM_REGIONS, EXAM_STAGES } from "@/domain/exam-catalog";
import {
  listNotices,
  matchesExamCategory,
  registrationState,
  sources,
} from "@/lib/server/exam-store";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const filters = await searchParams;
  const all = listNotices();
  const sourceList = sources();
  const results = all.filter(
    (item) =>
      (!filters.q || (item.content.title + item.content.text).includes(filters.q.slice(0, 100))) &&
      (!filters.category || matchesExamCategory(item.content, filters.category)) &&
      (!filters.region || item.content.region === filters.region) &&
      (!filters.year || String(item.content.year) === filters.year) &&
      (!filters.stage || item.content.stage === filters.stage),
  );
  const page = Math.max(
    1,
    Math.min(Math.ceil(results.length / 20) || 1, Number.parseInt(filters.page ?? "1") || 1),
  );
  function pageUrl(number: number): string {
    const params = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    params.set("page", String(number));
    return `/exams?${params}`;
  }
  return (
    <AppShell activePage="exams">
      <div className="space-y-7">
        <header>
          <p className="text-sm text-primary">学生考试信息</p>
          <h1 className="mt-2 text-3xl font-semibold">下一场考试，从这里准备</h1>
          <p className="mt-3 text-muted-foreground">
            升学、语言、计算机、职业资格与就业招录。报名条件因地区、考期和学籍不同，请核对官方要求。
          </p>
        </header>
        <form action="/exams" className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-3">
          <label>
            关键词
            <input
              className="mt-1 w-full rounded border p-2"
              name="q"
              defaultValue={filters.q}
              maxLength={100}
              placeholder="考试名 / 公告关键词"
            />
          </label>
          <label>
            考试类别
            <select
              name="category"
              defaultValue={filters.category ?? ""}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">全部类别</option>
              {EXAM_CATEGORIES.map(([id, name, group]) => (
                <option key={id} value={id}>
                  {group} · {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            适用地区
            <select
              name="region"
              defaultValue={filters.region ?? ""}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">全部地区</option>
              {EXAM_REGIONS.map((region) => (
                <option key={region}>{region}</option>
              ))}
            </select>
          </label>
          <label>
            年份
            <input
              name="year"
              type="number"
              min={2000}
              max={2100}
              defaultValue={filters.year}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            公告阶段
            <select
              name="stage"
              defaultValue={filters.stage ?? ""}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">全部阶段</option>
              {EXAM_STAGES.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-4">
            <button className="rounded bg-primary px-5 py-2 text-primary-foreground">筛选</button>
            <Link href="/exams" className="underline">
              清除
            </Link>
          </div>
        </form>
        <p role="status">
          当前筛选：
          {[
            filters.q,
            CATEGORY_LABELS[filters.category ?? ""],
            filters.region,
            filters.year,
            filters.stage,
          ]
            .filter(Boolean)
            .join(" / ") || "全部"}{" "}
          · 共{results.length}条已发布公告（最多显示最近2000条）
        </p>
        {!results.length && (
          <section className="rounded-xl border border-dashed p-8">
            <h2 className="font-semibold">暂未收录符合条件的公告</h2>
            <p className="mt-2 text-muted-foreground">
              这不代表没有考试或尚未发布。可调整筛选或前往下方官方入口查询；尚未审核的采集草稿不会出现在列表。
            </p>
            <Link href={pageUrl(1)} className="mt-3 inline-block underline">
              重新查询
            </Link>
          </section>
        )}
        <div className="grid gap-4">
          {results.slice((page - 1) * 20, page * 20).map((item) => (
            <article key={item.id} className="space-y-2 rounded-xl border bg-card p-5">
              <p className="text-xs text-primary">
                {CATEGORY_LABELS[item.content.category]} · {item.content.region} ·{" "}
                {item.content.edition} · {item.content.stage}
              </p>
              <h2 className="text-lg font-semibold">
                <Link className="hover:underline" href={`/exams/${item.id}`}>
                  {item.content.title}
                </Link>
              </h2>
              <p className="text-sm">{registrationState(item.content)}</p>
              <p className="text-xs text-muted-foreground">
                发布：{item.content.publishedAt || "待核实"} · {item.source_name} · 最近成功核查：
                {item.last_success || "手工录入，未自动核查"}
              </p>
            </article>
          ))}
        </div>
        <nav aria-label="公告分页" className="flex gap-5">
          {page > 1 && <Link href={pageUrl(page - 1)}>上一页</Link>}
          <span>第{page}页</span>
          {page * 20 < results.length && <Link href={pageUrl(page + 1)}>下一页</Link>}
        </nav>
        <details className="rounded-xl border p-5">
          <summary className="cursor-pointer font-medium">查看考试目录与实际覆盖</summary>
          <p className="my-3 text-sm">
            全国31个省级地区及港澳台可筛选；各地制度、报名方式与考试安排分别核对。目录存在不表示已经收齐公告，也不保证在校生均满足报考条件。
          </p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {EXAM_CATEGORIES.map(([id, name]) => (
              <li key={id}>
                {name} · {all.filter((n) => matchesExamCategory(n.content, id)).length}条已发布 ·{" "}
                {sourceList.some(
                  (s) => s.category === id || (id === "cet6" && s.category === "cet4"),
                )
                  ? "已登记来源"
                  : "来源待接入"}
              </li>
            ))}
          </ul>
        </details>
        <details className="rounded-xl border p-5">
          <summary className="cursor-pointer font-medium">31省级考试机构目录及本次访问核验</summary>
          <p className="my-3 text-sm">
            目录来自中国教育考试网官方链接；访问核验时间为2026-11-13。可访问只代表入口可读，公告是否成功采集见下方来源状态。港澳台尚未接入对应考试机构。
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {provincialSources.map((source) => (
              <li key={source.region} className="rounded border p-3 text-sm">
                <a
                  href={source.referenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {source.region} · {source.name}
                </a>
                <p>
                  {source.status === "accessible"
                    ? "入口可访问，已登记采集来源"
                    : "本次HTTPS访问失败，保留官方入口供人工查询"}
                </p>
              </li>
            ))}
          </ul>
        </details>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">官方信息入口与更新状态</h2>
          {sourceList.map((source) => (
            <div key={source.id} className="rounded border p-4 text-sm">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                {source.name}
              </a>
              <p className="mt-1">
                {source.region} · {source.enabled ? "定时检查已启用" : "定时检查未启用"} ·
                最近成功：{source.last_success || "尚未采集成功"}
              </p>
              {source.error && <p className="mt-1">最近采集情况：{source.error}</p>}
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
