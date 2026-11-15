import { requestTime } from "@/lib/server/request-time";
import { campusImportPreview } from "@/lib/campus";
import { learningEntries } from "@/lib/server/learning-store";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import { CampusHub } from "@/components/campus-hub";
import { sessionAccount } from "@/lib/server/account-auth";
import { campusState, campusNotices, campusLinkedNotices } from "@/lib/server/campus-store";
import { campusExamNodes } from "@/lib/server/campus-schedule";
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
    <AppShell activePage="campus">
      <CampusHub
        key={user.id}
        sourceNotices={campusLinkedNotices(user.id)}
        initialNow={now}
        initialProposal={proposal}
        initialEditor={editor}
        resources={learningEntries()
          .filter((entry) => entry.content.kind === "resource")
          .map((entry) => ({
            id: entry.id,
            title: entry.content.title,
            subject: entry.content.subject,
          }))}
        initialState={state}
        initialNotices={campusNotices(state.preferences.schoolId)}
        examNodes={campusExamNodes(user.id, now)}
      />
    </AppShell>
  );
}
