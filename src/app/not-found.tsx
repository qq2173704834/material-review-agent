import Link from "next/link";

import { Button } from "@/components/ui/button";

import type { ReactElement } from "react";

export default function NotFound(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl font-semibold">没有找到这个页面</h1>
      <p className="text-sm text-muted-foreground">地址可能有误，或内容已被移除。</p>
      <Button asChild>
        <Link href="/">返回首页</Link>
      </Button>
    </main>
  );
}
