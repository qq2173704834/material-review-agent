import type { ReactElement } from "react";
import { AppShell } from "@/components/app-shell";
import { CampusAdmin } from "@/components/campus-admin";
export default function Page(): ReactElement {
  return (
    <AppShell activePage="admin">
      <CampusAdmin />
    </AppShell>
  );
}
