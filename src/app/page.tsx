import Link from "next/link";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import ReviewTaskHome from "@/components/review-task-home";
import { isLegacyTestMode } from "@/lib/server/access-config";
import { listNotices, registrationState, sources } from "@/lib/server/exam-store";
import { platformDb } from "@/lib/server/platform-db";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import { isUpcoming, beijingDay } from "@/lib/portal-feed";
export const dynamic = "force-dynamic";
export default function Home(): ReactElement {
  if (isLegacyTestMode()) return <ReviewTaskHome />;
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
      title: "报名中",
      description: "仅展示已核对完整起止时刻的公告，实际报名通道仍需原站核对。",
      items: items.filter((item) => registrationState(item.content).startsWith("处于公布")),
    },
    {
      title: "考试临近",
      description: "未来30天内已公布考试节点，不推测未知日期。",
      items: recent.filter((item) =>
        item.content.timeline.some(
          (node) => /考试|笔试|面试/.test(node.label) && isUpcoming(node.value),
        ),
      ),
    },
    {
      title: "近期关注",
      description: "未来30天内有已公布节点的考试，按近期公告展示。",
      items: recent,
    },
    {
      title: "即将截止",
      description: "未来7天内公布的报名截止日期；具体时刻与通道以官方为准。",
      items: recent.filter((item) =>
        item.content.timeline.some(
          (node) => node.label === "报名截止" && isUpcoming(node.value, Date.now(), 7),
        ),
      ),
    },
    {
      title: "最近更新",
      description: "已审核发布的公告版本；无新增时保留历史，不编造考试。",
      items: latest,
    },
  ];
  if (popular.length)
    sections.unshift({
      title: "大家在关注",
      description: "至少3个账号实际收藏的公告，按收藏数排序，不代表报名人数。",
      items: popular.flatMap((row) => {
        const item = items.find((item) => item.id === row.notice_id);
        return item ? [item] : [];
      }),
    });
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
        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <Link href="/exams" className="text-sm underline">
                查看更多
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">{section.description}</p>
            {!section.items.length && (
              <p className="rounded-xl border border-dashed p-6">
                暂未收录匹配公告，可到考试中心浏览目录和官方入口。
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {section.items.slice(0, 6).map((item) => (
                <article key={item.id} className="space-y-3 rounded-xl border bg-card p-5">
                  <p className="text-xs text-primary">
                    {CATEGORY_LABELS[item.content.category]} · {item.content.region}
                  </p>
                  <h3 className="font-semibold">
                    <Link href={`/exams/${item.id}`}>{item.content.title}</Link>
                  </h3>
                  <p className="text-sm">
                    {item.content.edition} · {registrationState(item.content)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.source_name} · 核查{item.last_success || "手工审核，未自动核查"}
                  </p>
                  <Link
                    href={`/me?newCategory=${item.content.category}&noticeId=${item.id}#goals`}
                    className="inline-block text-sm underline"
                  >
                    设为目标
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
