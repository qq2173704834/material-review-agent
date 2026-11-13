import type { ReactElement } from "react";
import { AccountForm } from "@/components/account-forms";
export default function Page(): ReactElement {
  return (
    <main className="mx-auto max-w-lg px-5 py-12">
      <AccountForm mode="recover" />
    </main>
  );
}
