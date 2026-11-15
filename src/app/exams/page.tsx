import { headers } from "next/headers";
import { sessionAccount } from "@/lib/server/account-auth";
import { BrowsePosition } from "@/components/browse-back";
import { SearchFilters, type SearchField } from "@/components/search-filters";
import { ExamDirectory } from "@/components/exam-directory";
import { ExamStatus, RegistrationDeadline } from "@/components/registration-deadline";
import { requestTime } from "@/lib/server/request-time";
import { matchesExamSearch } from "@/lib/exam-discovery";
import { matchesExamDimensions } from "@/lib/exam-dimensions";
import { learningEntries } from "@/lib/server/learning-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import provincialSources from "@/domain/provincial-exam-sources.json";
import type { ReactElement } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  CATEGORY_LABELS,
  EXAM_CATEGORIES,
  EXAM_GROUPS,
  EXAM_REGIONS,
  EXAM_STAGES,
} from "@/domain/exam-catalog";
import { listNotices, matchesExamCategory, sources } from "@/lib/server/exam-store";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const filters = await searchParams;
  const now = await requestTime();
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  const knowledge = learningEntries();
  const all = listNotices().map((item) =>
    catalogLifecycle(knowledge, item.content.category, item.content.region).blocked &&
    item.content.disposition === "正常"
      ? { ...item, content: { ...item.content, disposition: "待核实" as const } }
      : item,
  );
  const sourceList = sources();
  const results = all.filter(
    (item) =>
      (!filters.q ||
        (item.content.title + item.content.text)
          .toLowerCase()
          .includes(filters.q.slice(0, 100).toLowerCase()) ||
        matchesExamSearch(item.content.category, filters.q.slice(0, 100)) ||
        item.content.categories?.some((id) => matchesExamSearch(id, filters.q!.slice(0, 100)))) &&
      (!filters.category || matchesExamCategory(item.content, filters.category)) &&
      (!filters.group ||
        EXAM_CATEGORIES.some(
          ([id, , group]) => matchesExamCategory(item.content, id) && group === filters.group,
        )) &&
      (!filters.region || item.content.region === filters.region) &&
      (!filters.year || String(item.content.year) === filters.year) &&
      (!filters.stage || item.content.stage === filters.stage) &&
      matchesExamDimensions(item.content, filters),
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
  const options = (values: readonly string[]): { value: string; label: string }[] =>
    values.map((value) => ({ value, label: value }));
  const common: SearchField[] = [
    { name: "q", label: "关键词" },
    {
      name: "category",
      label: "考试类别",
      options: EXAM_CATEGORIES.map(([value, label]) => ({ value, label })),
    },
    { name: "region", label: "适用地区", options: options(EXAM_REGIONS) },
  ];
  const extra: SearchField[] = [
    { name: "group", label: "考试方向", options: options(EXAM_GROUPS) },
    {
      name: "year",
      label: "年份",
      options: options([...new Set(all.map((item) => String(item.content.year)))].sort().reverse()),
    },
    { name: "stage", label: "公告阶段", options: options(EXAM_STAGES) },
  ];
  for (const [name, label, key] of [
    ["level", "等级", "levels"],
    ["subject", "科目", "subjects"],
    ["language", "语种", "languages"],
    ["examForm", "考试形式", "examForms"],
  ] as const) {
    const values = [
      ...new Set(
        all
          .filter(
            (item) => !filters.category || matchesExamCategory(item.content, filters.category),
          )
          .flatMap((item) => item.content[key] ?? []),
      ),
    ];
    if (values.length || filters[name]) extra.push({ name, label, options: options(values) });
  }
  const returnTo = encodeURIComponent(pageUrl(page));
  return (
    <AppShell activePage="exams">
      <div className="space-y-7">
        <header>
          <p className="text-sm text-primary">学生考试信息</p>
          <h1 className="mt-2 text-3xl font-semibold">下一场考试，从这里准备</h1>
        </header>
        {account && <BrowsePosition identity={account.id} />}
        <SearchFilters
          path="/exams"
          filters={filters}
          common={common}
          extra={extra}
          submit="查找考试"
        />
        <p role="status">
          找到{results.length}条公告 · 第{page}页
        </p>
        {!results.length && (
          <section className="rounded-xl border border-dashed p-8">
            <h2 className="font-semibold">暂未收录符合条件的公告</h2>
            <p className="mt-2 text-muted-foreground">试试调整筛选，或从官方入口了解最新安排。</p>
            <Link href={pageUrl(1)} className="mt-3 inline-block underline">
              重新查询
            </Link>
          </section>
        )}
        <div className="grid gap-4">
          {results.slice((page - 1) * 20, page * 20).map((item) => (
            <article key={item.id} className="surface space-y-2">
              <p className="text-xs text-primary">
                {CATEGORY_LABELS[item.content.category]} · {item.content.region} ·{" "}
                {item.content.edition} · {item.content.stage}
              </p>
              <h2 className="text-lg font-semibold">
                <Link className="hover:underline" href={`/exams/${item.id}?returnTo=${returnTo}`}>
                  {item.content.title}
                </Link>
              </h2>
              <ExamStatus
                disposition={item.content.disposition}
                timeline={item.content.timeline}
                stage={item.content.stage}
                initialNow={now}
              />
              <RegistrationDeadline
                disposition={item.content.disposition}
                timeline={item.content.timeline}
                stage={item.content.stage}
                initialNow={now}
              />
              <p className="text-xs text-muted-foreground">
                发布：{item.content.publishedAt || "日期待公布"} · {item.source_name}
              </p>
            </article>
          ))}
        </div>
        <nav aria-label="公告分页" className="flex gap-5">
          {page > 1 && <Link href={pageUrl(page - 1)}>上一页</Link>}
          <span>第{page}页</span>
          {page * 20 < results.length && <Link href={pageUrl(page + 1)}>下一页</Link>}
        </nav>
        <ExamDirectory
          query={filters.q}
          group={filters.group}
          category={filters.category}
          region={filters.region}
          sourceList={sourceList}
          notices={all}
        />
        <details className="surface">
          <summary className="goal-summary font-medium">各省考试院</summary>
          <ul className="grid gap-3 sm:grid-cols-2 mt-4">
            {provincialSources
              .filter(
                (source) =>
                  !filters.region || filters.region === "全国" || source.region === filters.region,
              )
              .map((source) => (
                <li className="rounded-xl border p-4" key={source.region}>
                  <h3 className="font-medium">
                    {source.region} · {source.name}
                  </h3>
                  <a
                    className="button-secondary mt-3"
                    href={source.referenceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    进入官网 ↗
                  </a>
                </li>
              ))}
          </ul>
        </details>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">官方入口</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {sourceList
              .filter(
                (source) =>
                  !provincialSources.some(
                    (item) =>
                      item.referenceUrl.replace(/\/$/, "") === source.url.replace(/\/$/, ""),
                  ) &&
                  (!filters.region || source.region === filters.region) &&
                  (!filters.category || source.category === filters.category),
              )
              .map((source) => (
                <article key={source.id} className="surface">
                  <h3 className="font-medium">{source.name}</h3>
                  <p className="text-sm text-muted-foreground mt-2">{source.region}</p>
                  <a
                    href={source.url}
                    className="button-secondary mt-3"
                    target="_blank"
                    rel="noreferrer"
                  >
                    进入官网 ↗
                  </a>
                </article>
              ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
