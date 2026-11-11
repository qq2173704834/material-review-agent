import "@/app/globals.css";

import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "材料预审工作台", template: "%s · 材料预审工作台" },
  description: "由具体通知与项目要求驱动的通用材料预审工作台。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
