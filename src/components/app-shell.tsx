import {
  ArrowUpRight,
  ClipboardCheck,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { ReactElement, ReactNode } from "react";

interface AppShellProps {
  activePage: "tasks" | "setup" | "task-detail";
  children: ReactNode;
}

const navigationItems = [
  { page: "tasks", href: "/", title: "审查任务", icon: LayoutDashboard },
  { page: "setup", href: "/setup", title: "本地环境", icon: Settings2 },
] as const;

export function AppShell({ activePage, children }: AppShellProps): ReactElement {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        跳到主要内容
      </a>
      <aside className="flex border-b border-border bg-card lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <Link
          href="/"
          className="flex items-center gap-3 px-5 py-6 lg:px-6 lg:py-8"
          aria-label="材料预审工作台首页"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
            <ClipboardCheck className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-wide">材料预审工作台</span>
            <span className="mt-0.5 block text-[10px] tracking-[0.18em] text-muted-foreground">
              MATERIAL REVIEW
            </span>
          </span>
        </Link>

        <nav
          aria-label="主导航"
          className="ml-auto flex items-center gap-1 px-3 lg:mt-3 lg:ml-0 lg:block lg:space-y-2 lg:px-4"
        >
          {navigationItems.map(({ page, href, title, icon: Icon }) => (
            <Link
              key={page}
              href={href}
              aria-current={activePage === page ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors",
                activePage === page
                  ? "bg-primary/8 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{title}</span>
              <span className="sr-only sm:hidden">{title}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto hidden p-4 lg:block">
          <div className="rounded-xl border border-border bg-background p-4">
            <ShieldCheck className="mb-3 size-5 text-primary" aria-hidden="true" />
            <p className="text-xs font-medium">每一项结论，都应有据可查</p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              从要求原文出发，区分明确问题与尚待核实的信息。
            </p>
            <Link
              href="/setup"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              查看当前阶段 <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </div>
          <p className="px-2 pt-5 text-[11px] text-muted-foreground">本地开发版 · v0.1.0</p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex h-20 items-center justify-between border-b border-border bg-card/60 px-6 lg:px-10">
          <p className="text-sm text-muted-foreground">
            工作空间 <span className="mx-2 text-border">/</span>{" "}
            {activePage === "setup" ? "本地环境" : "审查任务"}
          </p>
          <Badge className="border-primary/15 bg-primary/5 text-primary">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            本地开发
          </Badge>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1440px] px-5 py-8 outline-none sm:px-8 lg:px-10 lg:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
