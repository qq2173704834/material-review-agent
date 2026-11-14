"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
export function AccountNavigation(): ReactElement {
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (payload && typeof payload === "object" && "account" in payload) {
          const account = payload.account;
          setCanManage(
            !!account &&
              typeof account === "object" &&
              "role" in account &&
              account.role === "admin",
          );
        }
      })
      .catch(() => {
        // Failed identity lookups never expose management navigation.
      });
    return () => controller.abort();
  }, []);
  return (
    <>
      {canManage && (
        <>
          <Link href="/admin/system" className="block px-3 py-3 text-xs text-muted-foreground">
            服务维护
          </Link>
          <Link href="/admin/exams" className="block px-3 py-3 text-xs text-muted-foreground">
            内容管理
          </Link>
          <Link href="/admin/learning" className="block px-3 py-3 text-xs text-muted-foreground">
            学习与知识管理
          </Link>
        </>
      )}
      <Link href="/access" className="block px-3 py-3 text-xs text-muted-foreground">
        账号设置
      </Link>
    </>
  );
}
