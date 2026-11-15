import { SearchFilters, type SearchField } from "@/components/search-filters";
import { BrowsePosition } from "@/components/browse-back";
import { headers } from "next/headers";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LearningActions, LearningPreferences } from "@/components/learning-actions";
import { sessionAccount } from "@/lib/server/account-auth";
import { learningRecommendations } from "@/lib/server/learning-store";
import { studentGoals, portalPreferences } from "@/lib/server/student-goals";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import type { ReactElement } from "react";
import { ResourceCover } from "@/components/resource-cover";
import { normalizeSearchFilters } from "@/lib/search-filters";
export const dynamic = "force-dynamic";
export default async function Learn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement | null> {
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!account) return null;
  const filters = normalizeSearchFilters(await searchParams),
    goals = studentGoals(account.id),
    preferences = portalPreferences(account.id);
  const goal = filters.goal ? goals.find((goal) => goal.id === filters.goal) : undefined;
  const invalid = !!filters.goal && !goal;
  const available = invalid
    ? []
    : learningRecommendations(account.id, goal?.id, filters.hidden === "1");
  const extra: SearchField[] = [
    { name: "saved", label: "只看收藏", checkbox: true },
    { name: "hidden", label: "包含隐藏资料", checkbox: true },
  ];
  for (const [name, label, key] of [
    ["stage", "备考阶段", "studyStage"],
    ["subject", "科目", "subject"],
  ] as const) {
    const values = [...new Set(available.map((item) => item.content[key]).filter(Boolean))];
    if (values.length || filters[name])
      extra.unshift({ name, label, options: values.map((value) => ({ value, label: value })) });
  }
  const resources = invalid
    ? []
    : learningRecommendations(account.id, goal?.id, filters.hidden === "1").filter(
        (item) =>
          (!filters.q ||
            (item.content.title + item.content.text)
              .toLowerCase()
              .includes(filters.q.slice(0, 100).toLowerCase())) &&
          (!filters.category || item.content.category === filters.category) &&
          (!filters.format || item.content.format === filters.format) &&
          (!filters.stage || item.content.studyStage === filters.stage) &&
          (!filters.subject || item.content.subject.includes(filters.subject.slice(0, 120))) &&
          (filters.saved !== "1" || item.saved),
      );
  const page = Math.max(
    1,
    Math.min(Number.parseInt(filters.page ?? "1") || 1, Math.ceil(resources.length / 12) || 1),
  );
  function pageUrl(number: number): string {
    const params = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    params.set("page", String(number));
    return `/learn?${params}`;
  }
  return (
    <AppShell activePage="learn">
      <div className="space-y-6">
        <header className="page-heading">
          <p className="text-sm text-primary">围绕你的考试目标学习</p>
          <h1 className="my-2 text-3xl font-semibold">学习资源与备考资讯</h1>
          <p>找到适合你的资料，让今天的学习更有方向。</p>
        </header>
        <nav aria-label="学习方向" className="flex flex-wrap gap-2">
          <Link className="button-secondary" href="/learn">
            全部资料
          </Link>
          <Link className="button-secondary" href="/learn?category=education-local">
            大学公共基础
          </Link>
          <Link
            className="button-secondary"
            href="/learn?category=education-local&subject=竞赛备赛"
          >
            竞赛备赛
          </Link>
          <Link className="button-secondary" href="/learn?format=练习">
            原创练习
          </Link>
        </nav>
        <BrowsePosition identity={account.id} />
        <SearchFilters
          path="/learn"
          filters={filters}
          common={[
            {
              name: "goal",
              label: "考试目标",
              options: goals.map((goal) => ({
                value: goal.id,
                label: `${CATEGORY_LABELS[goal.category]} · ${goal.edition}`,
              })),
            },
            { name: "q", label: "资料关键词" },
            {
              name: "category",
              label: "考试 / 方向",
              options: [...new Set(available.map((item) => item.content.category))].map((id) => ({
                value: id,
                label: CATEGORY_LABELS[id] || id,
              })),
            },
            {
              name: "format",
              label: "资料形式",
              options: ["考纲", "课程", "资料", "练习", "资讯"].map((value) => ({
                value,
                label: value,
              })),
            },
          ]}
          extra={extra}
          submit="查找资料"
        />
        <LearningPreferences {...preferences} />
        {invalid && <p role="alert">考试目标不存在，请重新选择。</p>}
        <p role="status">
          共{resources.length}条资源 · 第{page}页
        </p>
        {!resources.length && (
          <section className="empty-state surface">
            <h2>{filters.saved === "1" ? "还没有符合条件的收藏" : "暂时没有匹配资料"}</h2>
            <p>试试调整条件，或查看其他考试的学习资料。</p>
            <Link href="/learn" className="button-secondary">
              清除筛选
            </Link>
            <Link href="/exams" className="button-secondary">
              浏览考试
            </Link>
          </section>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {resources.slice((page - 1) * 12, page * 12).map((item) => (
            <article key={item.id} className="resource-card surface space-y-3">
              <ResourceCover
                category={item.content.category}
                format={item.content.format}
                label={CATEGORY_LABELS[item.content.category] ?? item.content.category}
              />
              <p className="text-xs text-primary">{item.content.studyStage}</p>
              <h2 className="font-semibold">
                <Link href={`/learn/${item.id}?returnTo=${encodeURIComponent(pageUrl(page))}`}>
                  {item.content.title}
                </Link>
              </h2>
              <p className="text-sm">
                {item.content.text.startsWith("此条为公开官方入口导航")
                  ? "查看考试介绍、考纲与官方通知，前往原站获取资料。"
                  : !item.content.summary ||
                      /少量|不是NCRE|非完整考纲|不代表已读取/.test(item.content.summary)
                    ? item.content.text.slice(0, 180)
                    : item.content.summary}
              </p>

              <p className="text-xs text-muted-foreground">
                {item.content.author}
                {item.content.fee !== "未知" ? ` · ${item.content.fee}` : ""}
                {item.content.sourceType === "非官方参考" ? " · 第三方参考" : ""}
                {item.content.disposition !== "现行" ? ` · ${item.content.disposition}` : ""}
              </p>
              <Link
                className="button-primary"
                href={`/learn/${item.id}?returnTo=${encodeURIComponent(pageUrl(page))}`}
              >
                查看资料 →
              </Link>
              <LearningActions
                id={item.id}
                saved={item.saved}
                seen={item.seen}
                dismissed={item.dismissed}
              />
            </article>
          ))}
        </div>
        <nav aria-label="学习资料分页" className="flex gap-5">
          {page > 1 && <Link href={pageUrl(page - 1)}>上一页</Link>}
          {page * 12 < resources.length && <Link href={pageUrl(page + 1)}>下一页</Link>}
        </nav>
      </div>
    </AppShell>
  );
}
