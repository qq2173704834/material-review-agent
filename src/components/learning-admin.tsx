"use client";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { EXAM_CATEGORIES, EXAM_REGIONS } from "@/domain/exam-catalog";
import type { ContentEntry } from "@/domain/learning-content";
export function LearningAdmin(): ReactElement {
  const [dailyHour, setDailyHour] = useState(8);
  const [indexCheck, setIndexCheck] = useState<{
    checkedAt: string;
    strategy: string;
    entries: number;
    failures: Array<{ id: string; version: number; message: string }>;
  } | null>(null);
  const [feedback, setFeedback] = useState<
    Array<{ id: string; kind: string; payload: string; status: string; response: string }>
  >([]);
  const [entries, setEntries] = useState<ContentEntry[]>([]),
    [editing, setEditing] = useState<ContentEntry | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/learning", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (response.ok) {
          setEntries(data.entries);
          setFeedback(data.feedback);
          setDailyHour(data.dailyCheckHour);
          setIndexCheck(data.indexCheck);
        } else setMessage(data.error);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("内容读取失败。");
      });
    return () => controller.abort();
  }, []);
  async function act(input: unknown): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const current = await fetch("/api/admin/learning");
      if (!current.ok) throw new Error("保存成功，列表刷新失败，请重新加载。");
      const refreshed = await current.json();
      setEntries(refreshed.entries);
      setFeedback(refreshed.feedback);
      setDailyHour(refreshed.dailyCheckHour);
      setIndexCheck(refreshed.indexCheck);
      setEditing(null);
      setMessage("已保存，知识检索按已发布快照即时生效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请求失败。");
    } finally {
      setBusy(false);
    }
  }
  const [today] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  const content = editing?.content;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">学习资源与知识内容管理</h1>
        <p className="mt-3">
          资源、知识条目和高校参考先保存草稿。审核时核对来源、费用、授权、适用范围及当前状态；发布/撤回立即改变知识检索范围。
        </p>
      </header>
      <section className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">知识检索核查</h2>
        <p className="text-sm">
          本地检索直接读取已发布快照，无独立向量索引；内容发布或撤回即时生效，不需要重建缓存。
        </p>
        <button
          disabled={busy}
          className="underline"
          onClick={() => void act({ action: "check-index" })}
        >
          核查当前知识检索快照
        </button>
        {indexCheck && (
          <div className="text-sm">
            <p>
              {indexCheck.checkedAt} · 可检索{indexCheck.entries}条 · 异常
              {indexCheck.failures.length}条
            </p>
            {indexCheck.failures.map((failure) => (
              <p key={failure.id}>
                条目{failure.id} · v{failure.version}：{failure.message}
              </p>
            ))}
          </div>
        )}
      </section>
      <p role="status">{busy ? "正在处理…" : message}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act({ action: "schedule", hour: dailyHour });
        }}
        className="rounded border p-4"
      >
        <label>
          每日补查时点（北京时间0—23时）
          <input
            type="number"
            min={0}
            max={23}
            value={dailyHour}
            onChange={(event) => setDailyHour(Number(event.target.value))}
            className="m-2 rounded border p-2"
          />
        </label>
        <button disabled={busy} className="underline">
          保存每日时点
        </button>
        <p>
          更高频来源仍沿用原间隔；服务在线时逐源补查，离线不伪造成功。新来源默认不启用，内容仍需审核。
        </p>
      </form>
      <form
        key={editing?.id ?? "new"}
        className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          for (const key of ["catalogStatus", "catalogEffectiveAt", "renamedTo"])
            if (!values[key]) delete values[key];
          const { conflictsWith, ...fields } = values;
          void act({
            action: "draft",
            id: editing?.id,
            version: editing?.version,
            content: {
              ...fields,
              ...(conflictsWith
                ? {
                    conflictsWith: String(conflictsWith)
                      .split(/[，,；;]/)
                      .map((id) => id.trim())
                      .filter(Boolean),
                  }
                : {}),
            },
          });
        }}
      >
        <label>
          内容类型
          <select
            name="kind"
            defaultValue={content?.kind ?? "resource"}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="resource">学习资源</option>
            <option value="knowledge">知识库条目</option>
            <option value="school">高校参考</option>
          </select>
        </label>
        <label>
          考试类别
          <select
            name="category"
            defaultValue={content?.category}
            className="mt-1 w-full rounded border p-2"
          >
            {EXAM_CATEGORIES.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          目录举办状态（仅知识条目；不填不改变目录）
          <select
            name="catalogStatus"
            defaultValue={content?.catalogStatus ?? ""}
            className="mt-1 w-full rounded border p-2"
          >
            <option value="">不维护目录状态</option>
            {["待核实", "举办", "暂停", "停办", "更名"].map((state) => (
              <option key={state}>{state}</option>
            ))}
          </select>
        </label>
        <label>
          目录状态官方生效日期
          <input
            name="catalogEffectiveAt"
            type="date"
            defaultValue={content?.catalogEffectiveAt ?? ""}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        <label>
          更名后的官方名称
          <input
            name="renamedTo"
            maxLength={200}
            defaultValue={content?.renamedTo ?? ""}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        <label>
          适用地区
          <select
            name="region"
            defaultValue={content?.region ?? "全国"}
            className="mt-1 w-full rounded border p-2"
          >
            {EXAM_REGIONS.map((region) => (
              <option key={region}>{region}</option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          与其他已发布知识存在冲突（条目ID，用逗号分隔；发布前核对双方范围）
          <input
            name="conflictsWith"
            defaultValue={content?.conflictsWith?.join("，") ?? ""}
            maxLength={400}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        {(
          [
            ["title", "内容标题", 200],
            ["author", "作者 / 主办方", 200],
            ["url", "原始来源HTTPS网址", 2048],
            ["edition", "适用考期 / 学年版本", 80],
            ["subject", "科目", 120],
            ["language", "语言", 40],
            ["checkedAt", "核查日期", 10],
          ] as const
        ).map(([key, label, max]) => (
          <label key={key}>
            {label}
            <input
              name={key}
              required={["title", "author", "url", "language", "checkedAt"].includes(key)}
              type={key === "checkedAt" ? "date" : key === "url" ? "url" : "text"}
              maxLength={max}
              defaultValue={
                content?.[key] ?? (key === "language" ? "中文" : key === "checkedAt" ? today : "")
              }
              className="mt-1 w-full rounded border p-2"
            />
          </label>
        ))}
        {(
          [
            ["format", "资源形式", ["考纲", "课程", "资料", "练习", "资讯"]],
            ["studyStage", "备考阶段", ["通用", "入门", "基础", "强化", "冲刺"]],
            ["fee", "费用", ["未知", "免费", "付费"]],
            ["permission", "授权 / 使用方式", ["仅链接", "允许转载", "自有原创"]],
            ["disposition", "资料状态", ["待核实", "现行", "历史", "暂停", "停办"]],
          ] as const
        ).map(([key, label, options]) => (
          <label key={key}>
            {label}
            <select
              name={key}
              defaultValue={content?.[key] ?? options[0]}
              className="mt-1 w-full rounded border p-2"
            >
              {options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
        {(
          [
            ["summary", "简介", 1000],
            ["scope", "适用范围与限制", 1000],
            ["text", "已核对正文 / 引用", 30000],
            ["reviewNote", "审核依据（发布前至少10字）", 1000],
          ] as const
        ).map(([key, label, max]) => (
          <label key={key} className="sm:col-span-2">
            {label}
            <textarea
              required={key === "text" || key === "scope"}
              name={key}
              maxLength={max}
              defaultValue={content?.[key]}
              className="mt-1 min-h-24 w-full rounded border p-2"
            />
          </label>
        ))}
        <div className="flex gap-4">
          <button disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
            保存内容草稿
          </button>
          {editing && (
            <button type="button" onClick={() => setEditing(null)}>
              取消编辑
            </button>
          )}
        </div>
      </form>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">用户主动提交的内容反馈</h2>
        {feedback.map((item) => (
          <article key={item.id} className="rounded border p-3">
            <p>
              {item.kind} · {item.status}
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{item.payload}</pre>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void act({
                  action: "feedback",
                  id: item.id,
                  response: values.get("response"),
                  status: values.get("status"),
                });
              }}
            >
              <label>
                处理结果
                <input
                  name="response"
                  minLength={2}
                  maxLength={1000}
                  required
                  defaultValue={item.response}
                  className="m-2 rounded border p-2"
                />
              </label>
              <label>
                处理状态
                <select name="status" className="m-2 rounded border p-2">
                  {["处理中", "已处理", "无法确认"].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <button disabled={busy} className="underline">
                保存反馈处理
              </button>
            </form>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">已登记内容 · {entries.length}</h2>
        {entries.map((entry) => (
          <article className="space-y-2 rounded border p-4" key={entry.id}>
            <h3 className="font-semibold">{entry.content.title}</h3>
            <p>
              {entry.content.kind} · {entry.status} · 草稿v{entry.version} ·{" "}
              {entry.content.checkedAt}
            </p>
            <p>{entry.content.scope}</p>
            <details>
              <summary>修订历史（管理员）</summary>
              {entry.history?.map((version) => (
                <p key={version.version}>
                  v{version.version} · {version.created_at}
                </p>
              ))}
            </details>
            <div className="flex flex-wrap gap-4">
              <button disabled={busy} className="underline" onClick={() => setEditing(entry)}>
                查看/修订原文
              </button>
              <button
                disabled={busy}
                className="underline"
                onClick={() =>
                  void act({ action: "publish", id: entry.id, version: entry.version })
                }
              >
                核对并发布此版本
              </button>
              <button
                disabled={busy}
                className="underline"
                onClick={() =>
                  void act({ action: "withdraw", id: entry.id, version: entry.version })
                }
              >
                撤回
              </button>
              <a className="underline" href={entry.content.url} target="_blank" rel="noreferrer">
                原始来源
              </a>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
