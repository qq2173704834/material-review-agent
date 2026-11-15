import { BookOpen, ClipboardCheck, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { AccountNavigation } from "@/components/account-navigation";

import { cn } from "@/lib/utils";

import type { ReactElement, ReactNode } from "react";

interface AppShellProps {
  activePage: "home" | "learn" | "tasks" | "setup" | "task-detail" | "exams" | "me" | "admin";
  children: ReactNode;
}

const navigationItems = [
  { page: "home", href: "/", title: "首页", icon: LayoutDashboard },
  { page: "learn", href: "/learn", title: "学习", icon: BookOpen },
  { page: "exams", href: "/exams", title: "考试中心", icon: LayoutDashboard },
  { page: "me", href: "/me", title: "备考中心", icon: ClipboardCheck },
  { page: "tasks", href: "/tasks", title: "材料预审", icon: LayoutDashboard },
] as const;

export function AppShell({ activePage, children }: AppShellProps): ReactElement {
  return (
    <div className="app-frame min-h-screen lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        跳到主要内容
      </a>
      <aside className="app-sidebar flex flex-col border-b border-border bg-card lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-r lg:border-b-0">
        <Link
          href="/"
          className="flex items-center gap-3 px-5 py-6 lg:px-6 lg:py-8"
          aria-label="考试与学习平台首页"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
            <ClipboardCheck className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-wide">考试与学习</span>
            <span className="mt-0.5 block text-[10px] tracking-[0.18em] text-muted-foreground">
              EXAMS & LEARNING
            </span>
          </span>
        </Link>

        <nav
          aria-label="主导航"
          className="flex w-full flex-wrap items-center gap-1 px-3 pb-3 lg:mt-3 lg:block lg:space-y-2 lg:px-4"
        >
          {navigationItems.map(({ page, href, title, icon: Icon }) => (
            <Link
              key={page}
              href={href}
              aria-current={activePage === page ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-sm transition-colors sm:flex-row sm:gap-3 sm:px-3",
                activePage === page
                  ? "bg-primary/8 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="text-xs sm:text-sm">{title}</span>
            </Link>
          ))}
          <AccountNavigation />
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="app-topbar flex h-16 items-center justify-between border-b border-border bg-card/80 px-5 lg:px-9">
          <p className="text-sm text-muted-foreground">
            考试与学习 <span className="mx-2 text-border">/</span>{" "}
            {activePage === "home"
              ? "首页"
              : activePage === "learn"
                ? "学习"
                : activePage === "setup"
                  ? "服务维护"
                  : activePage === "exams"
                    ? "考试中心"
                    : activePage === "me"
                      ? "备考中心"
                      : activePage === "admin"
                        ? "内容管理"
                        : "审查任务"}
          </p>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="app-main mx-auto max-w-[1520px] px-4 pt-6 pb-28 outline-none sm:px-7 lg:px-9 lg:pt-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
