import { requestTime } from "@/lib/server/request-time";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import { CampusHub } from "@/components/campus-hub";
import { sessionAccount } from "@/lib/server/account-auth";
import { campusState, campusNotices, campusLinkedNotices } from "@/lib/server/campus-store";

export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const user = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!user) redirect("/login?next=%2Fcampus");
  const now = await requestTime();
  const state = campusState(user.id);
  const filters = await searchParams;
  if (filters.proposal || filters.edit || filters.view === "schedule") {
    const query = new URLSearchParams();
    for (const key of ["proposal", "edit", "goal", "group"])
      if (filters[key]) query.set(key, filters[key]);
    redirect(`/me/schedule?${query}`);
  }
  return (
    <AppShell activePage="campus">
      <CampusHub
        key={user.id}
        sourceNotices={campusLinkedNotices(user.id)}
        initialNow={now}
        initialState={state}
        initialNotices={campusNotices(state.preferences.schoolId)}
        mode="notices"
        initialNoticeId={filters.notice}
      />
    </AppShell>
  );
}
