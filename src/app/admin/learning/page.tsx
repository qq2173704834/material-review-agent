import { AppShell } from "@/components/app-shell";
import { LearningAdmin } from "@/components/learning-admin";
import type { ReactElement } from "react";
export default function Page(): ReactElement {
  return (
    <AppShell activePage="admin">
      <LearningAdmin />
    </AppShell>
  );
}
