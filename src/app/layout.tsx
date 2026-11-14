import { ExamAssistantWidget } from "@/components/exam-assistant-widget";
import { isLegacyTestMode } from "@/lib/server/access-config";
import "@/app/globals.css";

import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "考试与学习", template: "%s · 考试与学习" },
  description: "由具体通知与项目要求驱动的通用考试与学习。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {!isLegacyTestMode() && <ExamAssistantWidget />}
      </body>
    </html>
  );
}
