import type { ReactElement } from "react";
import Link from "next/link";
export default function Page(): ReactElement {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-20">
      <h1 className="text-3xl font-semibold">找到考试，准备好每一份材料</h1>
      <p>
        为在校学生整理升学、语言、计算机与职业资格等考试信息，追踪官方公告，并在需要时预审报名材料。
      </p>
      <p>考试公告的真实来源与更新状态均可核查。预审供准备材料参考，最终要求以考试组织方为准。</p>
      <nav className="flex gap-6">
        <Link href="/register" className="text-primary underline">
          注册账号
        </Link>
        <Link href="/login" className="text-primary underline">
          登录
        </Link>
      </nav>
    </main>
  );
}
