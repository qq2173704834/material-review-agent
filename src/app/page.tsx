import { connection } from "next/server";
import { examCardState } from "@/lib/exam-card-state";
import Link from "next/link";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import ReviewTaskHome from "@/components/review-task-home";
import { isLegacyTestMode } from "@/lib/server/access-config";
import { listNotices, sources } from "@/lib/server/exam-store";
import { platformDb } from "@/lib/server/platform-db";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { isUpcoming, beijingDay } from "@/lib/portal-feed";
export const dynamic = "force-dynamic";
async function homepageTime(): Promise<number> {
  await connection();
  return Date.now();
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  if (isLegacyTestMode()) return <ReviewTaskHome />;
  const filters = await searchParams,
    now = await homepageTime();
  const items = listNotices(),
    sourceList = sources();
  const recent = items.filter(
    (item) =>
      item.content.disposition === "正常" &&
      item.content.timeline.some((node) => isUpcoming(node.value)),
  );
  const latest = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const popular = platformDb()
    .prepare<[], { notice_id: string; count: number }>(
      "SELECT notice_id,COUNT(*) count FROM exam_favorites GROUP BY notice_id HAVING COUNT(*)>=3 ORDER BY count DESC LIMIT 12",
    )
    .all();
  const daily = platformDb()
    .prepare<[string], { status: string; message: string; finished_at: string }>(
      "SELECT * FROM portal_daily_runs WHERE day=?",
    )
    .get(beijingDay());
  const sections = [
    {
      id: "current",
      title: "当前考试",
      description: "优先展示处于报名日期范围或今日有考试安排的项目。",
      items: items.filter((item) => examCardState(item.content, now).current),
    },
    {
      id: "registration",
      title: "报名中",
      description: "绿色表示处于已公布的完整报名时段；仅有日期时以黄色提示具体时刻待确认。",
      items: items.filter((item) => examCardState(item.content, now).kind === "registration"),
    },
    {
      id: "exam",
      title: "考试临近",
      description: "未来30天内及今日的已公布考试安排。",
      items: recent.filter((item) =>
        item.content.timeline.some(
          (node) => /^(考试|笔试|面试)$/.test(node.label) && isUpcoming(node.value, now),
        ),
      ),
    },
    {
      id: "recent",
      title: "近期关注",
      description: "未来30天内有已公布节点的考试。",
      items: recent,
    },
    {
      id: "deadline",
      title: "即将截止",
      description: "未来7天内的报名截止安排，具体时刻请核对官方公告。",
      items: recent.filter((item) =>
        item.content.timeline.some(
          (node) => node.label === "报名截止" && isUpcoming(node.value, now, 7),
        ),
      ),
    },
    {
      id: "latest",
      title: "最近更新",
      description: "最近审核发布的公告，可能包含历史考期，请留意状态。",
      items: latest,
    },
  ];
  if (popular.length)
    sections.push({
      id: "popular",
      title: "大家在关注",
      description: "至少3个账号实际收藏的公告，不代表报名人数。",
      items: popular.flatMap((row) => {
        const item = items.find((item) => item.id === row.notice_id);
        return item ? [item] : [];
      }),
    });
  const selected = sections.find((section) => section.id === filters.tab) ?? sections[0]!;
  const tones = {
    green: "bg-emerald-500",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    gray: "bg-slate-400",
  };
  return (
    <AppShell activePage="home">
      <div className="space-y-8">
        <header className="rounded-2xl bg-primary/5 p-7">
          <p className="text-sm text-primary">为下一场考试做好准备</p>
          <h1 className="my-3 text-3xl font-semibold">考试信息与学习，一站跟进</h1>
          <p className="text-muted-foreground">
            找到近期考试、设定目标、收集资料，遇到问题随时咨询右下角助手。
          </p>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link href="/exams" className="rounded bg-primary px-4 py-2 text-primary-foreground">
              找考试
            </Link>
            <Link href="/me#goals" className="rounded border px-4 py-2">
              我的考试目标
            </Link>
            <Link href="/learn" className="rounded border px-4 py-2">
              开始学习
            </Link>
          </div>
        </header>
        <section className="rounded-xl border p-4 text-sm" aria-label="每日更新状态">
          <p>
            北京时间 {beijingDay()} · {daily?.message ?? "今日更新检查尚未完成；只展示已审核信息。"}
          </p>
          <p className="mt-2 text-muted-foreground">
            已启用{sourceList.filter((source) => source.enabled).length}个来源；
            {sourceList.filter((source) => source.error).length}
            个来源存在失败或部分结果。每日检查不等于每天都有新公告。
          </p>
        </section>
        <section className="space-y-5" aria-label="近期考试">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">近期考试</h2>
            <Link href="/exams" className="shrink-0 text-sm text-primary hover:underline">
              全部考试 →
            </Link>
          </div>
          <nav aria-label="考试状态筛选" className="flex flex-wrap gap-2 border-b pb-3">
            {sections.map((section) => (
              <Link
                key={section.id}
                href={`/?tab=${section.id}#exam-cards`}
                aria-current={selected.id === section.id ? "page" : undefined}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${selected.id === section.id ? "bg-primary font-medium text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {section.title}
                <span className="ml-2 text-xs opacity-75">{section.items.length}</span>
              </Link>
            ))}
          </nav>
          <div id="exam-cards" className="scroll-mt-5">
            <p className="mb-4 text-sm text-muted-foreground">{selected.description}</p>
            {!selected.items.length ? (
              <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center">
                <p className="font-medium">
                  暂未收录
                  {selected.title === "当前考试"
                    ? "正在报名或今日考试的项目"
                    : `“${selected.title}”的考试信息`}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  可切换“最近更新”，或到考试中心查看目录和官方入口。
                </p>
                <Link
                  href="/?tab=latest#exam-cards"
                  className="mt-4 inline-block text-sm text-primary underline"
                >
                  查看最近更新
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {selected.items.slice(0, 12).map((item) => {
                  const state = examCardState(item.content, now);
                  return (
                    <article
                      key={item.id}
                      className="flex min-h-60 flex-col rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md sm:aspect-square"
                      aria-label={`${item.content.title}，${state.label}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-md bg-primary/5 px-2 py-1 text-xs font-medium text-primary">
                          {CATEGORY_LABELS[item.content.category]}
                        </span>
                        <span
                          className="inline-flex shrink-0 items-center gap-1.5 text-xs"
                          title={state.detail}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-2 rounded-full ${tones[state.tone]}`}
                          />
                          {state.label}
                        </span>
                      </div>
                      <h3 className="mt-4 line-clamp-3 font-semibold leading-6">
                        <Link
                          href={`/exams/${item.id}`}
                          className="hover:text-primary"
                          title={item.content.title}
                        >
                          {item.content.title}
                        </Link>
                      </h3>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.content.region} · {item.content.edition}
                      </p>
                      <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {state.detail}
                      </p>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-5 text-sm">
                        <Link
                          href={`/exams/${item.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          查看详情 →
                        </Link>
                        <Link
                          href={`/me?newCategory=${item.content.category}&noticeId=${item.id}#goals`}
                          className="text-muted-foreground hover:text-primary"
                        >
                          ＋关注目标
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {selected.items.length > 12 && (
              <Link href="/exams" className="mt-5 inline-block text-sm text-primary underline">
                前往考试中心查看其余公告
              </Link>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
