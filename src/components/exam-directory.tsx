import Link from "next/link";
import { EXAM_CATEGORIES, EXAM_GROUPS } from "@/domain/exam-catalog";
import { EXAM_PORTALS } from "@/domain/exam-portals";
import { examProfile, matchesExamSearch } from "@/lib/exam-discovery";
import { matchesExamCategory } from "@/lib/server/exam-store";
import { learningEntries } from "@/lib/server/learning-store";
import { catalogLifecycle } from "@/lib/catalog-lifecycle";
import type { ExamSource, ExamNotice } from "@/lib/server/exam-store";
import type { ReactElement } from "react";
export function ExamDirectory({
  query = "",
  group,
  category,
  region = "全国",
  notices,
}: {
  query?: string;
  group?: string;
  category?: string;
  region?: string;
  sourceList: ExamSource[];
  notices: ExamNotice[];
}): ReactElement {
  const items = EXAM_CATEGORIES.filter(
    ([id, , direction]) =>
      (!group || direction === group) &&
      (!category || id === category) &&
      matchesExamSearch(id, query),
  );
  const knowledge = learningEntries();
  return (
    <details
      id="exam-directory"
      open={!!(query || category || group)}
      className="rounded-xl border bg-card p-5"
    >
      <summary className="cursor-pointer font-semibold">
        浏览考试目录 · {EXAM_CATEGORIES.length}类
      </summary>
      <p className="my-4 text-sm text-muted-foreground">
        查找感兴趣的考试，查看报考资料或添加备考目标。
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
                  portals = EXAM_PORTALS.filter((portal) => portal.category === id),
                  lifecycle = catalogLifecycle(knowledge, id, region),
                  facts = knowledge
                    .filter(
                      (entry) =>
                        entry.content.category === id &&
                        entry.content.kind === "knowledge" &&
                        !entry.content.catalogStatus &&
                        entry.content.disposition === "现行" &&
                        (entry.content.region === "全国" || entry.content.region === region),
                    )
                    .slice(0, 3);
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
                    {lifecycle.evidence.length > 0 && (
                      <>
                        <p>{lifecycle.label}</p>
                        {lifecycle.evidence.map((entry) => (
                          <Link
                            className="block prep-link"
                            key={entry.id}
                            href={`/learn/${entry.id}`}
                          >
                            状态依据：{entry.content.title}
                          </Link>
                        ))}
                      </>
                    )}
                    <p className="text-muted-foreground">{profile.audience}</p>
                    {facts.length > 0 && (
                      <details
                        className="rounded-md bg-muted/40 p-2"
                        data-testid={`exam-facts-${id}`}
                      >
                        <summary className="cursor-pointer">报考与证书资料</summary>
                        <ul className="mt-2 space-y-3">
                          {facts.map((entry) => (
                            <li key={entry.id}>
                              <Link className="underline" href={`/learn/${entry.id}`}>
                                {entry.content.title}
                              </Link>
                              {entry.content.sourceType === "非官方参考" && (
                                <p className="text-amber-700">第三方参考</p>
                              )}
                              <p className="mt-1">
                                {entry.content.text.slice(0, 240)}
                                {entry.content.text.length > 240 ? "…" : ""}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {entry.content.region} · {entry.content.edition || "考试介绍"}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <Link className="block prep-link" href={`/learn?category=${id}`}>
                      查看相关学习资料 →
                    </Link>
                    {portals.map((portal) => (
                      <p key={portal.url}>
                        <a className="prep-link" href={portal.url} target="_blank" rel="noreferrer">
                          访问考试官网 ↗
                        </a>
                      </p>
                    ))}
                    <Link className="inline-block underline" href={`/me?newCategory=${id}#goals`}>
                      设为考试目标
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </details>
  );
}
