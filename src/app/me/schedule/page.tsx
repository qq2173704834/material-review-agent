import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import { CampusHub } from "@/components/campus-hub";
import { sessionAccount } from "@/lib/server/account-auth";
import { campusState, campusNotices, campusLinkedNotices } from "@/lib/server/campus-store";
import { examScheduleNodes } from "@/lib/server/personal-schedule";
import { learningEntries } from "@/lib/server/learning-store";
import { campusImportPreview } from "@/lib/campus";
import { requestTime } from "@/lib/server/request-time";

export const dynamic = "force-dynamic";
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<ReactElement> {
  const user = sessionAccount(new Request("http://local", { headers: await headers() }));
  if (!user) redirect("/login?next=%2Fme%2Fschedule");
  const filters = await searchParams,
    state = campusState(user.id);
  const proposal = (filters.proposal || "").slice(0, 3000);
  const prior = state.events.find((event) => event.id === filters.edit);
  const draft = proposal ? campusImportPreview(proposal)[0] : undefined;
  const editor = prior
    ? {
        ...prior,
        ...(draft?.start ? { start: draft.start } : {}),
        ...(draft?.end ? { end: draft.end } : {}),
      }
    : undefined;
  return (
    <AppShell activePage="me">
      <CampusHub
        key={user.id}
        mode="schedule"
        initialState={state}
        sourceNotices={campusLinkedNotices(user.id)}
        initialNotices={campusNotices(state.preferences.schoolId)}
        initialNow={await requestTime()}
        initialProposal={proposal}
        initialEditor={editor}
        initialGoal={filters.goal || ""}
        initialGroup={filters.group || ""}
        initialPending={filters.pending === "1"}
        initialEditMissing={!!filters.edit && !prior}
        examNodes={examScheduleNodes(user.id)}
        resources={learningEntries()
          .filter((item) => item.content.kind === "resource")
          .map((item) => ({
            id: item.id,
            title: item.content.title,
            subject: item.content.subject,
          }))}
      />
    </AppShell>
  );
}
