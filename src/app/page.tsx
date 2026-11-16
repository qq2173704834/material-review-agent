import { examTimeline } from "@/lib/exam-timeline";
import { CampusSummary } from "@/components/campus-summary";
import { connection } from "next/server";
import { examCardState } from "@/lib/exam-card-state";
import { ExamStatus, RegistrationDeadline } from "@/components/registration-deadline";
import Link from "next/link";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import ReviewTaskHome from "@/components/review-task-home";
import { isLegacyTestMode } from "@/lib/server/access-config";
import { listNotices } from "@/lib/server/exam-store";
import { platformDb } from "@/lib/server/platform-db";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { isUpcoming, homepageOptions } from "@/lib/portal-feed";
import { learningEntries } from "@/lib/server/learning-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import { StudyIllustration } from "@/components/study-illustration";
import { Sparkles, ArrowUpRight, CalendarDays } from "lucide-react";
import { formatExamTime } from "@/lib/goal-schedule";
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
  const options = homepageOptions(filters);
  const knowledge = learningEntries();
  const items = listNotices().map((item) =>
    catalogLifecycle(knowledge, item.content.category, item.content.region).blocked &&
    item.content.disposition === "正常"
      ? { ...item, content: { ...item.content, disposition: "待核实" as const } }
      : item,
  );
  const recent = items.filter(
    (item) =>
      item.content.disposition === "正常" &&
      examTimeline(item.content).some((node) => isUpcoming(node.value, now, options.days)),
  );
  const latest = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const popular = platformDb()
    .prepare<[], { notice_id: string; count: number }>(
      "SELECT notice_id,COUNT(*) count FROM exam_favorites GROUP BY notice_id HAVING COUNT(*)>=3 ORDER BY count DESC LIMIT 12",
    )
    .all();
  const sections = [
    {
      id: "current",
      title: "当前考试",
      description: "报名中与考试中的项目。",
      items: items.filter((item) => examCardState(item.content, now).current),
    },
    {
      id: "registration",
      title: "报名中",
      description: "查看正在报名的考试。",
      items: items.filter((item) => examCardState(item.content, now).kind === "registration"),
    },
    {
      id: "exam",
      title: "考试临近",
      description: `未来${options.days}天内及今日的已公布考试安排。`,
      items: recent.filter((item) =>
        examTimeline(item.content).some(
          (node) =>
            /^(考试|笔试|面试)$/.test(node.label) && isUpcoming(node.value, now, options.days),
        ),
      ),
    },
    {
      id: "recent",
      title: "近期关注",
      description: `未来${options.days}天内有已公布节点的考试。`,
      items: recent,
    },
    {
      id: "deadline",
      title: "即将截止",
      description: "未来7天即将截止报名。",
      items: recent.filter((item) =>
        examTimeline(item.content).some(
          (node) => node.label === "报名截止" && isUpcoming(node.value, now, 7),
        ),
      ),
    },
    {
      id: "latest",
      title: "最近更新",
      description: "最新考试公告。",
      items: latest,
    },
  ];
  if (popular.length)
    sections.push({
      id: "popular",
      title: "大家在关注",
      description: "看看大家近期关注的考试。",
      items: popular.flatMap((row) => {
        const item = items.find((item) => item.id === row.notice_id);
        return item ? [item] : [];
      }),
    });
  const defaultSection = sections[0]!.items.length
    ? sections[0]!
    : (sections.find((section) => section.id === "exam" && section.items.length) ??
      sections.find((section) => section.id === "latest")!);
  const selected = sections.find((section) => section.id === filters.tab) ?? defaultSection;
  const nextEvent = recent
    .flatMap((item) =>
      examTimeline(item.content)
        .filter(
          (node) =>
            isUpcoming(node.value, now, 90) &&
            (!node.value.includes("T") || Date.parse(node.value) >= now),
        )
        .map((node) => ({ item, node })),
    )
    .sort((a, b) => a.node.value.localeCompare(b.node.value))[0];
  return (
    <AppShell activePage="home">
      <div className="space-y-8">
        <header className="home-hero">
          <div className="home-hero-copy">
            <p className="hero-eyebrow">
              <Sparkles size={15} /> 为下一场考试做好准备
            </p>
            <h1 className="my-4 font-semibold tracking-tight">
              下一场考试，
              <br />
              <span>从这里出发</span>
            </h1>
            <p className="text-muted-foreground">关注考试动态，让每一步备考都有方向。</p>
            <div className="mt-5 flex flex-wrap gap-4">
              <Link href="/exams" className="button-primary">
                找考试 <ArrowUpRight size={17} />
              </Link>
              <Link href="/me#goals" className="button-secondary">
                我的考试目标
              </Link>
              <Link href="/learn" className="hero-learning-link">
                开始学习
              </Link>
            </div>
          </div>
          <div className="home-hero-art">
            <StudyIllustration />
          </div>
        </header>
        <CampusSummary now={now} />
        {nextEvent && (
          <Link href={`/exams/${nextEvent.item.id}`} className="next-event-strip">
            <span className="next-event-icon">
              <CalendarDays size={22} />
            </span>
            <span>
              <small>近期考试推荐 · {nextEvent.node.label}</small>
              <strong>{nextEvent.item.content.title}</strong>
            </span>
            <time>{formatExamTime(nextEvent.node.value)}</time>
            <ArrowUpRight size={19} />
          </Link>
        )}
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
                href={`/?tab=${section.id}&days=${options.days}&size=${options.size}#exam-cards`}
                aria-current={selected.id === section.id ? "page" : undefined}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${selected.id === section.id ? "bg-primary font-medium text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {section.title}
                <span className="ml-2 text-xs">{section.items.length}</span>
              </Link>
            ))}
          </nav>
          <details className="content-settings">
            <summary>展示设置</summary>
            <form className="content-toolbar flex flex-wrap items-end gap-3" action="/">
              <input type="hidden" name="tab" value={selected.id} />
              <label>
                近期范围
                <select
                  aria-label="近期范围"
                  name="days"
                  defaultValue={options.days}
                  className="ml-2 rounded border p-2"
                >
                  {[7, 30, 60, 90].map((days) => (
                    <option key={days} value={days}>
                      未来{days}天
                    </option>
                  ))}
                </select>
              </label>
              <label>
                展示数量
                <select
                  aria-label="展示数量"
                  name="size"
                  defaultValue={options.size}
                  className="ml-2 rounded border p-2"
                >
                  {[6, 12, 24].map((size) => (
                    <option key={size} value={size}>
                      {size}条
                    </option>
                  ))}
                </select>
              </label>
              <button className="rounded border px-3 py-2">应用</button>
            </form>
          </details>
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
                  {selected.id === "latest"
                    ? "暂无公告，去找找感兴趣的考试。"
                    : "试试最近更新或浏览全部考试。"}
                </p>
                <Link
                  href={selected.id === "latest" ? "/exams" : "/?tab=latest#exam-cards"}
                  className="mt-4 inline-block text-sm text-primary underline"
                >
                  {selected.id === "latest" ? "前往考试中心" : "查看最近更新"}
                </Link>
              </div>
            ) : (
              <div className="exam-card-grid">
                {selected.items.slice(0, options.size).map((item) => {
                  return (
                    <article key={item.id} className="exam-card" aria-label={item.content.title}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <span className="max-w-full rounded-md bg-primary/8 px-2 py-1 text-xs font-medium text-primary">
                          {CATEGORY_LABELS[item.content.category]}
                        </span>
                        <ExamStatus
                          title={item.content.title}
                          disposition={item.content.disposition}
                          timeline={examTimeline(item.content)}
                          stage={item.content.stage}
                          initialNow={now}
                        />
                      </div>
                      <h3 className="mt-4 line-clamp-3 shrink-0 font-semibold leading-6">
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
                      <p className="mt-3 line-clamp-2 shrink-0 text-xs leading-5 text-muted-foreground">
                        {item.content.summary || "查看报名条件与考试安排。"}
                      </p>
                      <RegistrationDeadline
                        disposition={item.content.disposition}
                        timeline={examTimeline(item.content)}
                        stage={item.content.stage}
                        initialNow={now}
                      />
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-sm">
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
            {selected.items.length > options.size && (
              <Link href="/exams" className="mt-5 inline-block text-sm text-primary underline">
                查看更多公告 →
              </Link>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
