import { headers } from "next/headers";
import Link from "next/link";
import type { ReactElement } from "react";
import { sessionAccount } from "@/lib/server/account-auth";
import { campusState, campusNotices, campusDisplayEvents } from "@/lib/server/campus-store";
import { countdownLabel as examCountdownLabel } from "@/lib/goal-schedule";
function countdownLabel(value: string, now: number): string {
  return !value
    ? "时间待定"
    : examCountdownLabel(
        value.length > 10 && !/[Z+]/u.test(value) ? `${value}:00+08:00` : value,
        now,
      );
}
export async function CampusSummary({ now }: { now: number }): Promise<ReactElement | null> {
  const user = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!user) return null;
  const state = campusState(user.id),
    notices = campusNotices(state.preferences.schoolId)
      .filter((notice) => state.reads[notice.id] !== notice.digest)
      .slice(0, 2);
  const events = campusDisplayEvents(user.id)
    .filter((event) => !event.done)
    .sort((a, b) => (a.end || a.start || "9999").localeCompare(b.end || b.start || "9999"))
    .slice(0, 3);
  if (!notices.length && !events.length) return null;
  return (
    <section className="rounded-2xl border bg-card p-5" aria-label="我的校园">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">我的校园</h2>
        <Link className="text-sm text-primary" href="/campus">
          校园事务 →
        </Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {events.map((event) => (
          <Link key={event.id} className="rounded-xl bg-muted/50 p-3 text-sm" href="/campus">
            <span className="mr-2 text-primary">{event.kind}</span>
            {event.title}
            <span className="mt-1 block text-xs text-muted-foreground">
              {countdownLabel(event.end || event.start, now)}
            </span>
          </Link>
        ))}
        {notices.map((notice) => (
          <Link key={notice.id} className="rounded-xl bg-muted/50 p-3 text-sm" href="/campus">
            <span className="mr-2 text-primary">未读通知</span>
            {notice.title}
          </Link>
        ))}
      </div>
    </section>
  );
}
