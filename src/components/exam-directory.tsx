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
  sourceList,
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
                    <p>{lifecycle.label}</p>
                    {lifecycle.evidence.map((entry) => (
                      <p key={entry.id}>
                        <Link className="underline" href={`/learn/${entry.id}`}>
                          状态依据：{entry.content.title} · v{entry.version}
                        </Link>{" "}
                        · 核验{entry.content.checkedAt}
                      </p>
                    ))}
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
                    {facts.length > 0 && (
                      <details
                        className="rounded-md bg-muted/40 p-2"
                        data-testid={`exam-facts-${id}`}
                      >
                        <summary className="cursor-pointer">报考与证书资料 · 核对适用范围</summary>
                        <ul className="mt-2 space-y-3">
                          {facts.map((entry) => (
                            <li key={entry.id}>
                              <Link className="underline" href={`/learn/${entry.id}`}>
                                {entry.content.title}
                              </Link>
                              {entry.content.sourceType === "非官方参考" && (
                                <p className="text-amber-700">非官方参考 · 政策待核实</p>
                              )}
                              <p className="mt-1">
                                {entry.content.text.slice(0, 240)}
                                {entry.content.text.length > 240 ? "…" : ""}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {entry.content.region} ·{" "}
                                {entry.content.edition || "通用介绍，非当期公告"} · 核验
                                {entry.content.checkedAt} · v{entry.version}
                              </p>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs">
                          以上为资料摘录，不是个人资格结论。完整范围、来源原文和阅读边界见详情。
                        </p>
                      </details>
                    )}
                    {sources.some((source) => source.error) && (
                      <p className="text-amber-700">
                        {sources.filter((source) => source.failures > 0).length}个来源最近采集失败，
                        {sources.filter((source) => source.error && source.failures === 0).length}
                        个来源有部分详情异常；保留上次有效信息，不表示没有考试。
                      </p>
                    )}
                    {sources.map((source) => (
                      <p key={source.id} className="text-xs">
                        {source.name}：
                        {source.provenance ? (
                          <>
                            {source.provenance.organizer} · {source.provenance.relationship} ·{" "}
                            {source.provenance.result} · 核验
                            {source.provenance.checkedAt.slice(0, 10)} ·{" "}
                            <a
                              className="underline"
                              href={source.provenance.referenceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              关系原文依据
                            </a>
                          </>
                        ) : (
                          "组织关系证据尚待登记，不仅凭域名认定权威。"
                        )}
                      </p>
                    ))}
                    {portals.map((portal) => (
                      <p key={portal.url}>
                        <a className="underline" href={portal.url} target="_blank" rel="noreferrer">
                          官方入口
                        </a>{" "}
                        · 核验{portal.checkedAt}，入口可读不代表报名开放
                        {"collectionNote" in portal && (
                          <span className="block text-xs text-muted-foreground">
                            {portal.collectionNote}
                          </span>
                        )}
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
