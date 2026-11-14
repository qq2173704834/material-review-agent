import { BookOpen, ClipboardCheck, LayoutDashboard, Settings2 } from "lucide-react";
import Link from "next/link";

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
  { page: "me", href: "/me", title: "我的考试", icon: ClipboardCheck },
  { page: "tasks", href: "/tasks", title: "材料预审", icon: LayoutDashboard },
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
      <aside className="flex flex-col border-b border-border bg-card lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
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
          <Link href="/admin/exams" className="block px-3 py-3 text-xs text-muted-foreground">
            内容管理
          </Link>
          <Link href="/admin/learning" className="block px-3 py-3 text-xs text-muted-foreground">
            学习与知识管理
          </Link>
          <Link href="/access" className="block px-3 py-3 text-xs text-muted-foreground">
            账号与访问身份
          </Link>
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="flex h-20 items-center justify-between border-b border-border bg-card/60 px-6 lg:px-10">
          <p className="text-sm text-muted-foreground">
            工作空间 <span className="mx-2 text-border">/</span>{" "}
            {activePage === "home"
              ? "首页"
              : activePage === "learn"
                ? "学习"
                : activePage === "setup"
                  ? "本地环境"
                  : activePage === "exams"
                    ? "考试中心"
                    : activePage === "me"
                      ? "我的考试"
                      : activePage === "admin"
                        ? "内容管理"
                        : "审查任务"}
          </p>
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
