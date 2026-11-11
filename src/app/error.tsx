"use client";

import { Button } from "@/components/ui/button";

import type { ReactElement } from "react";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="text-2xl font-semibold">页面暂时无法加载</h1>
      <p className="text-sm text-muted-foreground">请重试；若问题持续，请查看本地服务日志。</p>
      <Button onClick={reset}>重新加载</Button>
    </main>
  );
}
