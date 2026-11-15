import { headers } from "next/headers";
import Link from "next/link";
import type { ReactElement } from "react";
import { sessionAccount } from "@/lib/server/account-auth";
import { campusState, campusNotices } from "@/lib/server/campus-store";
import { personalSchedule } from "@/lib/server/personal-schedule";
import { hasCampusNoticeSource } from "@/domain/campus-schools";
import {
  scheduleDate,
  scheduleOverdue,
  scheduleTimestamp,
  formatScheduleTime,
  scheduleCountdown,
} from "@/lib/schedule";

export async function CampusSummary({ now }: { now: number }): Promise<ReactElement | null> {
  const user = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!user) return null;
  const state = campusState(user.id);
  const notices = campusNotices(state.preferences.schoolId)
    .filter((notice) => !notice.withdrawn)
    .toSorted(
      (a, b) =>
        Number(state.preferences.interests.includes(b.category)) -
          Number(state.preferences.interests.includes(a.category)) ||
        b.publishedAt.localeCompare(a.publishedAt),
    )
    .slice(0, 3);
  const nodes = personalSchedule(user.id).filter((node) => !node.done);
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const upcoming = nodes
    .filter((node) => scheduleDate(node.value))
    .toSorted((a, b) => {
      const rank = (value: string): number =>
        scheduleDate(value) === today ? 0 : scheduleOverdue(value, now) ? 1 : 2;
      return (
        rank(a.value) - rank(b.value) || scheduleTimestamp(a.value) - scheduleTimestamp(b.value)
      );
    })
    .slice(0, 3);
  const pending = nodes.filter((node) => !scheduleDate(node.value)).length;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="surface space-y-4" aria-label="本校重要通知">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">本校重要通知</h2>
          <Link className="text-sm text-primary" href="/campus">
            查看全部 →
          </Link>
        </div>
        {notices.map((notice) => (
          <Link
            key={notice.id}
            href={`/campus?notice=${notice.id}#notice-${notice.id}`}
            className="block rounded-xl bg-muted/50 p-3 text-sm"
          >
            <span className="mb-1 block text-xs text-muted-foreground">
              {notice.category} · {notice.publishedAt} ·{" "}
              {state.reads[notice.id] === notice.digest ? "已读" : "未读"}
            </span>
            <span className="line-clamp-2 font-medium">{notice.title}</span>
          </Link>
        ))}
        {!notices.length && (
          <p className="text-sm text-muted-foreground">
            {state.preferences.schoolId
              ? hasCampusNoticeSource(state.preferences.schoolId)
                ? "本校暂时没有新通知。"
                : "暂未收录本校通知，可查看学校信息或管理个人日程。"
              : "选择学校，关注与你有关的新消息。"}
            <Link href="/campus" className="ml-2 text-primary underline">
              {state.preferences.schoolId ? "查看学校" : "选择我的学校"}
            </Link>
          </p>
        )}
      </section>
      <section className="surface space-y-4" aria-label="本人近期事项">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">本人近期事项</h2>
          <Link className="text-sm text-primary" href="/me/schedule">
            查看全部 →
          </Link>
        </div>
        {upcoming.map((node) => (
          <Link
            key={node.id}
            href={
              node.origin === "campus"
                ? node.href
                : `/me/schedule?${node.goalIds[0] ? `goal=${node.goalIds[0]}` : ""}`
            }
            className="block rounded-xl bg-muted/50 p-3 text-sm"
          >
            <span className="line-clamp-2 font-medium">{node.title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {node.label} · {formatScheduleTime(node.value)}
              {node.endValue && ` 至 ${formatScheduleTime(node.endValue)}`} ·{" "}
              {scheduleOverdue(node.endValue || node.value, now)
                ? "已到期 · 待完成"
                : scheduleCountdown(node.value, now)}
            </span>
          </Link>
        ))}
        {!upcoming.length && (
          <p className="text-sm text-muted-foreground">
            暂无近期有明确日期的待办。
            <Link className="ml-2 text-primary underline" href="/me">
              选择考试目标
            </Link>
            ，或
            <Link className="text-primary underline" href="/me/schedule">
              添加课程与作业
            </Link>
            。
          </p>
        )}
        {pending > 0 && (
          <Link className="inline-block text-sm text-primary" href="/me/schedule?pending=1#pending">
            时间待定 {pending} 项 →
          </Link>
        )}
      </section>
    </div>
  );
}
