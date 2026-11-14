import Link from "next/link";
import { EXAM_CATEGORIES, EXAM_GROUPS } from "@/domain/exam-catalog";
import { EXAM_PORTALS } from "@/domain/exam-portals";
import { examProfile, matchesExamSearch } from "@/lib/exam-discovery";
import { matchesExamCategory } from "@/lib/server/exam-store";
import type { ExamSource, ExamNotice } from "@/lib/server/exam-store";
import type { ReactElement } from "react";
export function ExamDirectory({
  query = "",
  group,
  category,
  sourceList,
  notices,
}: {
  query?: string;
  group?: string;
  category?: string;
  sourceList: ExamSource[];
  notices: ExamNotice[];
}): ReactElement {
  const items = EXAM_CATEGORIES.filter(
    ([id, , direction]) =>
      (!group || direction === group) &&
      (!category || id === category) &&
      matchesExamSearch(id, query),
  );
  return (
    <details
      id="exam-directory"
      open={!!(query || category || group)}
      className="rounded-xl border bg-card p-5"
    >
      <summary className="cursor-pointer font-semibold">
        查看考试目录与实际覆盖 · {EXAM_CATEGORIES.length}类
      </summary>
      <p className="my-4 text-sm text-muted-foreground">
        目录用于查找和职业规划，不代表均在举办或在校生均可报考；具体考期以官方通知为准。各省及港澳台地区可筛选，实际来源逐项显示。
      </p>
      {!items.length && <p>没有匹配的目录项，可清除关键词或类别。</p>}
      {EXAM_GROUPS.filter((group) => items.some((item) => item[2] === group)).map((group) => (
        <section aria-label={`${group}目录`} key={group} className="my-5">
          <h2 className="mb-3 font-semibold">{group}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items
              .filter((item) => item[2] === group)
              .map(([id, name]) => {
                const profile = examProfile(id),
                  sources = sourceList.filter(
                    (source) =>
                      source.category === id || (id === "cet6" && source.category === "cet4"),
                  ),
                  portals = EXAM_PORTALS.filter((portal) => portal.category === id);
                return (
                  <li
                    key={id}
                    data-exam-category={id}
                    className="space-y-2 rounded-lg border p-4 text-sm"
                  >
                    <Link
                      className="font-medium text-primary underline"
                      href={`/exams?category=${id}#exam-directory`}
                    >
                      {name}
                    </Link>
                    <p>
                      {profile.kind} ·{" "}
                      {notices.filter((notice) => matchesExamCategory(notice.content, id)).length}
                      条已发布
                    </p>
                    <p>
                      {sources.some((source) => source.last_success)
                        ? "已有来源采集成功（公告需逐篇审核）"
                        : sources.length
                          ? "已登记，尚无采集成功记录"
                          : portals.length
                            ? "仅官方查询入口，采集待接入"
                            : "来源待核验接入"}
                    </p>
                    <p className="text-muted-foreground">{profile.audience}</p>
                    {portals.map((portal) => (
                      <p key={portal.url}>
                        <a className="underline" href={portal.url} target="_blank" rel="noreferrer">
                          官方入口
                        </a>{" "}
                        · 核验{portal.checkedAt}，入口可读不代表报名开放
                      </p>
                    ))}
                    <Link className="inline-block underline" href={`/me?newCategory=${id}#goals`}>
                      设为考试目标
                    </Link>
                    {id === "french-specialty" && (
                      <p className="text-xs">
                        高校参考：
                        <a
                          className="underline"
                          href="https://sfb.shnu.edu.cn/84/7d/c15123a820349/page.htm"
                          target="_blank"
                          rel="noreferrer"
                        >
                          上海师范大学商学院2024年11月细则
                        </a>
                        曾提及法语专八，仅适用该文件范围，不代表全国加分。
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </details>
  );
}
