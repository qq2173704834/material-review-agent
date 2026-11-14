import type { ReactElement } from "react";
import { AccountForm } from "@/components/account-forms";
export default function Page(): ReactElement {
  return (
    <main className="auth-page mx-auto max-w-lg px-5 py-12">
      <AccountForm mode="login" />
    </main>
  );
}
