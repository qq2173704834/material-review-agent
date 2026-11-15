"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

export function PreparationNavigation(): ReactElement {
  const pathname = usePathname();
  return (
    <nav className="page-tabs mb-6" aria-label="我的备考导航">
      {[
        ["/me", "考试目标"],
        ["/me/schedule", "我的日程"],
        ["/me/records", "学习记录"],
      ].map(([href, label]) => (
        <Link
          key={href}
          href={href!}
          aria-current={
            href === "/me"
              ? pathname !== "/me/schedule" && pathname !== "/me/records"
                ? "page"
                : undefined
              : pathname === href
                ? "page"
                : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
