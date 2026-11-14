import { headers } from "next/headers";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LearningActions, LearningPreferences } from "@/components/learning-actions";
import { sessionAccount } from "@/lib/server/account-auth";
import { learningRecommendations } from "@/lib/server/learning-store";
import { studentGoals, portalPreferences } from "@/lib/server/student-goals";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import type { ReactElement } from "react";
export const dynamic = "force-dynamic";
export default async function Learn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement | null> {
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!account) return null;
  const filters = await searchParams,
    goals = studentGoals(account.id),
    preferences = portalPreferences(account.id);
  const goal = filters.goal ? goals.find((goal) => goal.id === filters.goal) : undefined;
  const invalid = !!filters.goal && !goal;
  const resources = invalid
    ? []
    : learningRecommendations(account.id, goal?.id, filters.hidden === "1").filter(
        (item) =>
          (!filters.q ||
            (item.content.title + item.content.text)
              .toLowerCase()
              .includes(filters.q.slice(0, 100).toLowerCase())) &&
          (!filters.format || item.content.format === filters.format) &&
          (!filters.stage || item.content.studyStage === filters.stage) &&
          (!filters.subject || item.content.subject.includes(filters.subject.slice(0, 120))) &&
          (!filters.saved || item.saved),
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
        <form className="surface grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label>
            考试目标
            <select
              name="goal"
              defaultValue={goal?.id ?? ""}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">通用资源</option>
              {goals
                .filter((goal) => goal.state === "active")
                .map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {CATEGORY_LABELS[goal.category]} · {goal.edition}
                  </option>
                ))}
            </select>
          </label>
          <label>
            资料关键词
            <input
              name="q"
              maxLength={100}
              defaultValue={filters.q}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            科目
            <input
              name="subject"
              maxLength={120}
              defaultValue={filters.subject}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            资料形式
            <select
              name="format"
              defaultValue={filters.format ?? ""}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">全部形式</option>
              {["考纲", "课程", "资料", "练习", "资讯"].map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
          </label>
          <label>
            备考阶段
            <select
              name="stage"
              defaultValue={filters.stage ?? ""}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">全部阶段</option>
              {["通用", "入门", "基础", "强化", "冲刺"].map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <label className="self-center">
            <input name="saved" value="1" type="checkbox" defaultChecked={!!filters.saved} />{" "}
            只看我的资料收藏
          </label>
          <label className="self-center">
            <input
              name="hidden"
              value="1"
              type="checkbox"
              defaultChecked={filters.hidden === "1"}
            />{" "}
            包含我隐藏的资料（可恢复推荐）
          </label>
          <div className="flex items-center gap-4">
            <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
              筛选资源
            </button>
            <Link className="underline" href="/learn">
              清除
            </Link>
          </div>
        </form>
        <LearningPreferences {...preferences} />
        {invalid && <p role="alert">考试目标不存在，请重新选择。</p>}
        <p role="status">
          共{resources.length}条资源 · 第{page}页
        </p>
        {!resources.length && (
          <p className="rounded border border-dashed p-6">
            当前条件暂无已审核资料。可切换目标或前往考试中心官方入口；未接入内容不会生成虚假资源。
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {resources.slice((page - 1) * 12, page * 12).map((item) => (
            <article key={item.id} className="resource-card surface space-y-3">
              <p className="text-xs text-primary">
                {CATEGORY_LABELS[item.content.category]} · {item.content.format} ·{" "}
                {item.content.studyStage}
              </p>
              <h2 className="font-semibold">
                <Link href={`/learn/${item.id}`}>{item.content.title}</Link>
              </h2>
              <p className="text-sm">{item.content.summary || item.content.text.slice(0, 180)}</p>
              <p className="text-sm">{item.reason}</p>
              <p className="text-xs text-muted-foreground">
                {item.content.author} · {item.content.fee} · {item.content.permission} · 核查
                {item.content.checkedAt} · {item.content.disposition}
              </p>
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
