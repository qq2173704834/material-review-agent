import type { ReactElement } from "react";
import Link from "next/link";
import { isLegacyTestMode } from "@/lib/server/access-config";
import { notice } from "@/lib/server/exam-store";
import { platformDb } from "@/lib/server/platform-db";
export function TaskExamContext({ taskId }: { taskId: string }): ReactElement | null {
  if (isLegacyTestMode()) return null;
  const link = platformDb()
    .prepare<
      [string],
      { notice_id: string; notice_version: number; stage: string; target: string }
    >("SELECT * FROM exam_task_links WHERE task_id=?")
    .get(taskId);
  if (!link) return null;
  const item = notice(link.notice_id);
  return (
    <aside className="mb-5 space-y-2 rounded-xl border bg-card p-4 text-sm">
      <p>
        考试公告关联 · {link.stage} · {link.target || "具体对象待确认"} · 已采用v
        {link.notice_version}
      </p>
      <Link href="/me" className="mr-4 text-primary underline">
        我的考试工作台
      </Link>
      {item ? (
        <Link href={`/exams/${item.id}`} className="text-primary underline">
          查看考试公告
          {item.version !== link.notice_version ? "（已有新版，请到工作台核对并明确采用）" : ""}
        </Link>
      ) : (
        <span>公告已撤回，原任务快照保留。</span>
      )}
    </aside>
  );
}
