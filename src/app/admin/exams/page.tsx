import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import { ExamAdmin } from "@/components/exam-admin";
export default function Page(): ReactElement {
  return (
    <AppShell activePage="admin">
      <ExamAdmin />
    </AppShell>
  );
}
