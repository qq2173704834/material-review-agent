import type { ReactElement } from "react";
import { headers } from "next/headers";
import { AccountForm } from "@/components/account-forms";
import { sessionAccount } from "@/lib/server/account-auth";
import { AppShell } from "@/components/app-shell";
export const dynamic = "force-dynamic";
export default async function Page(): Promise<ReactElement> {
  const account = sessionAccount(new Request("http://local", { headers: await headers() }));
  return (
    <AppShell activePage="me">
      <section className="auth-page mx-auto max-w-lg px-5 py-12">
        <p className="mb-5">
          当前账号：{account?.username} · {account?.nickname}
        </p>
        <AccountForm mode="account" />
      </section>
    </AppShell>
  );
}
