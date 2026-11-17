"use client";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { EXAM_CATEGORIES, EXAM_REGIONS, EXAM_STAGES, TIMELINE_LABELS } from "@/domain/exam-catalog";
import type { ExamNotice, ExamSource } from "@/lib/server/exam-store";
const field = "mt-1 w-full rounded border bg-background p-2";
interface AdminData {
  sources: ExamSource[];
  notices: ExamNotice[];
  runs: Array<{
    id: number;
    source_id: string;
    status: string;
    message: string;
    started_at: string;
  }>;
}
export function ExamAdmin(): ReactElement {
  const [data, setData] = useState<AdminData>({ sources: [], notices: [], runs: [] });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ExamNotice | null>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/exams");
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error);
        return;
      }
      setData(payload);
    } catch {
      setMessage("后台读取失败，请重试。");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/exams", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (response.ok) setData(payload);
        else setMessage(payload.error);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("后台读取失败，请重试。");
      });
    return () => controller.abort();
  }, [load]);
  async function act(body: unknown): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      setMessage(payload.error ?? payload.message ?? "已保存。");
      if (response.ok) await load();
      return response.ok;
    } catch {
      setMessage("操作未完成，请重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const content = editing?.content;
  const visibleSources = data.sources.filter((source) => {
    const matchesQuery = `${source.name} ${source.region} ${source.url}`
      .toLocaleLowerCase()
      .includes(sourceQuery.trim().toLocaleLowerCase());
    const matchesStatus =
      sourceFilter === "all" ||
      (sourceFilter === "enabled" && !!source.enabled) ||
      (sourceFilter === "disabled" && !source.enabled) ||
      (sourceFilter === "error" && !!source.error);
    return matchesQuery && matchesStatus;
  });
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">考试内容管理</h1>
        <p className="mt-3">
          官方采集先进入草稿。发布前核对标题、考期、适用地区与日期引用，未知日期留空。
        </p>
      </header>
      <p role="status" className="rounded border p-3">
        {busy ? "正在处理，请稍候…" : message || "就绪"}
      </p>
      <button onClick={() => void load()} className="rounded border p-2">
        刷新后台
      </button>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">官方来源与受控调度</h2>
        <p className="text-sm">
          服务运行期间每分钟检查到期来源；默认每6小时采集，失败退避，上限48小时。关闭本站服务时不会继续采集。
        </p>
        <p className="text-sm text-muted-foreground">
          每日补查不提前重试失败来源；优先检查最久未尝试的来源。手动“采集一次”可立即重试，新内容仍只保存草稿。
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1">
            搜索来源名称、地区或网址
            <input
              type="search"
              className={field}
              value={sourceQuery}
              onChange={(event) => setSourceQuery(event.target.value)}
            />
          </label>
          <label>
            来源状态
            <select
              aria-label="来源状态"
              className={field}
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
            >
              <option value="all">全部来源</option>
              <option value="enabled">已启用</option>
              <option value="disabled">未启用</option>
              <option value="error">失败或部分异常</option>
            </select>
          </label>
        </div>
        <p role="status" className="text-sm">
          显示{visibleSources.length}/{data.sources.length}个来源，已启用
          {data.sources.filter((source) => source.enabled).length}个。
        </p>
        {!visibleSources.length && <p>没有匹配的来源，请调整搜索或状态筛选。</p>}
        {visibleSources.map((source) => (
          <div className="flex flex-wrap items-center gap-3 rounded border p-4" key={source.id}>
            <a
              href={source.url}
              className="text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              {source.name}
            </a>
            <span className="text-sm">
              {source.enabled ? "已启用" : "未启用"} · 每{source.interval_hours}小时 · 下次：
              {source.enabled
                ? source.next_run > 0
                  ? `${new Date(source.next_run).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）`
                  : "等待调度检查"
                : "暂停"}
            </span>
            <button
              disabled={busy}
              className="rounded border p-2"
              onClick={() => void act({ action: "collect", id: source.id })}
            >
              采集一次
            </button>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void act({
                  action: "source",
                  id: source.id,
                  enabled: values.get("enabled") === "on",
                  intervalHours: Number(values.get("intervalHours")),
                });
              }}
            >
              <label>
                <input name="enabled" type="checkbox" defaultChecked={!!source.enabled} />
                启用
              </label>
              <label>
                间隔小时
                <input
                  name="intervalHours"
                  type="number"
                  min={1}
                  max={168}
                  defaultValue={source.interval_hours}
                  className="ml-1 w-16 rounded border p-1"
                />
              </label>
              <button disabled={busy} className="rounded border px-2">
                保存调度
              </button>
            </form>
            <p className="w-full text-xs">
              最近成功：{source.last_success || "无"} · 最近失败/部分结果：{source.error || "无"}
            </p>
            <details className="w-full rounded border p-3">
              <summary className="cursor-pointer text-sm">
                组织关系与核验依据 · {source.provenance?.result ?? "尚未登记"}
              </summary>
              <form
                key={source.provenance?.checkedAt ?? "new-proof"}
                className="mt-3 grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = Object.fromEntries(new FormData(event.currentTarget));
                  void act({ action: "source-proof", id: source.id, provenance: values });
                }}
              >
                <label>
                  主办方/委托方名称
                  <input
                    name="organizer"
                    required
                    maxLength={200}
                    defaultValue={source.provenance?.organizer}
                    className={field}
                  />
                </label>
                <label>
                  来源关系
                  <select
                    name="relationship"
                    defaultValue={source.provenance?.relationship ?? "待核实"}
                    className={field}
                  >
                    {["待核实", "主办机构", "受托承办", "官方信息发布"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  官方关系依据地址
                  <input
                    name="referenceUrl"
                    required
                    type="url"
                    maxLength={2048}
                    defaultValue={source.provenance?.referenceUrl}
                    className={field}
                  />
                </label>
                <label>
                  核验结果
                  <select
                    name="result"
                    defaultValue={source.provenance?.result ?? "待核实"}
                    className={field}
                  >
                    <option>待核实</option>
                    <option>已核对</option>
                  </select>
                </label>
                <label className="sm:col-span-2">
                  组织关系原文引用（至少10字，保存时实际读取核对）
                  <textarea
                    name="quote"
                    required
                    minLength={10}
                    maxLength={2000}
                    defaultValue={source.provenance?.quote}
                    className={field}
                  />
                </label>
                <p className="text-xs">
                  上次核验：{source.provenance?.checkedAt ?? "无"}
                  。域名外观或可访问不等于主办授权关系。
                </p>
                <button disabled={busy} className="rounded border px-3 py-2">
                  核验并保存来源依据
                </button>
              </form>
            </details>
          </div>
        ))}
      </section>
      <details className="rounded-xl border p-5">
        <summary className="cursor-pointer font-medium">登记其他官方考试来源</summary>
        <p className="my-3 text-sm">
          限公开政府/教育机构及研招网HTTPS入口，服务端会校验访问及跳转。登记不等于公告已采集或发布。
        </p>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            void act({ action: "register-source", ...values });
          }}
        >
          <label>
            来源名称
            <input name="name" required maxLength={200} className={field} />
          </label>
          <label>
            官方入口
            <input name="url" type="url" required className={field} />
          </label>
          <label>
            考试类别
            <select name="category" className={field}>
              {EXAM_CATEGORIES.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            地区
            <select name="region" className={field}>
              {EXAM_REGIONS.map((region) => (
                <option key={region}>{region}</option>
              ))}
            </select>
          </label>
          <button disabled={busy} className="rounded border p-3">
            核验并登记（不启用调度）
          </button>
        </form>
      </details>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          {editing ? "审核 / 修改公告草稿" : "手工录入公告"}
        </h2>
        {editing && (
          <button className="rounded border p-2" onClick={() => setEditing(null)}>
            取消编辑，录入新公告
          </button>
        )}
        <form
          key={`${editing?.id ?? "new"}-${editing?.version ?? 0}`}
          className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = Object.fromEntries(new FormData(form));
            const timeline = TIMELINE_LABELS.map((label, index) => ({
              label,
              value: String(values[`time${index}`] ?? ""),
              ...(values[`timeEnd${index}`] ? { endValue: String(values[`timeEnd${index}`]) } : {}),
              quote: String(values[`quote${index}`] ?? ""),
            })).filter((p) => p.value || p.quote);
            let attachments;
            try {
              attachments = String(values.attachments ?? "").trim()
                ? String(values.attachments)
                    .trim()
                    .split("\n")
                    .map((line) => {
                      const [name, url] = line.split("|").map((v) => v.trim());
                      return { name, url, status: "仅官方链接，未读取" };
                    })
                : [];
            } catch {
              setMessage("附件须逐行输入名称|网址");
              return;
            }
            const next = {
              title: values.title,
              category: values.category,
              categories: new FormData(form).getAll("categories"),
              ...Object.fromEntries(
                ["levels", "subjects", "languages", "examForms"].map((key) => [
                  key,
                  String(values[key] ?? "")
                    .split(/[，,；;]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                ]),
              ),
              ...(values.textScope ? { textScope: values.textScope } : {}),
              region: values.region,
              edition: values.edition,
              year: Number(values.year),
              stage: values.stage,
              organizer: values.organizer,
              publishedAt: values.publishedAt,
              text: values.text,
              summary: values.summary,
              audience: values.audience,
              disposition: values.disposition,
              timeline,
              attachments,
              ...(values.relatedId ? { relatedId: values.relatedId } : {}),
            };
            void act({
              action: "draft",
              sourceId: values.sourceId,
              url: values.url,
              content: next,
            });
          }}
        >
          <label>
            登记来源
            <select required name="sourceId" className={field} defaultValue={editing?.source_id}>
              {data.sources.map((source) => (
                <option value={source.id} key={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            官方原文URL
            <input
              required
              type="url"
              name="url"
              className={field}
              defaultValue={editing?.canonical_url}
            />
          </label>
          <label className="sm:col-span-2">
            官方标题
            <input
              required
              name="title"
              maxLength={300}
              className={field}
              defaultValue={content?.title}
            />
          </label>
          <label>
            考试类别
            <select name="category" className={field} defaultValue={content?.category}>
              {EXAM_CATEGORIES.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            适用地区
            <select name="region" className={field} defaultValue={content?.region}>
              {EXAM_REGIONS.map((region) => (
                <option key={region}>{region}</option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            同时适用的其他考试（按Ctrl或Command多选；同一公告只保存一个对象）
            <select
              name="categories"
              multiple
              defaultValue={content?.categories ?? []}
              className={field}
            >
              {EXAM_CATEGORIES.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["levels", "适用等级"],
              ["subjects", "适用科目"],
              ["languages", "适用语种"],
              ["examForms", "考试形式（笔试、口试、面试、机考、实操、材料评审）"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                defaultValue={content?.[key]?.join("，") ?? ""}
                maxLength={2000}
                placeholder="可用中文逗号分隔；未知留空"
                className={field}
              />
            </label>
          ))}
          <label>
            原文保存范围
            <select name="textScope" defaultValue={content?.textScope ?? ""} className={field}>
              <option value="">沿用未标注范围（需核对）</option>
              <option value="全文">全文</option>
              <option value="摘录">摘录</option>
            </select>
          </label>
          <label>
            年份
            <input
              type="number"
              name="year"
              min={2000}
              max={2100}
              defaultValue={content?.year ?? new Date().getFullYear()}
              className={field}
              required
            />
          </label>
          <label>
            考期 / 批次
            <input
              name="edition"
              required
              maxLength={80}
              className={field}
              defaultValue={content?.edition}
            />
          </label>
          <label>
            组织方
            <input
              name="organizer"
              required
              maxLength={200}
              className={field}
              defaultValue={content?.organizer}
            />
          </label>
          <label>
            公告发布日期（未知留空）
            <input
              name="publishedAt"
              maxLength={40}
              className={field}
              defaultValue={content?.publishedAt}
            />
          </label>
          <label>
            公告阶段
            <select name="stage" className={field} defaultValue={content?.stage}>
              {EXAM_STAGES.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <label>
            考试状态
            <select
              name="disposition"
              className={field}
              defaultValue={content?.disposition ?? "待核实"}
            >
              {["正常", "延期", "取消", "待核实"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            原文快照
            <textarea
              name="text"
              required
              maxLength={200000}
              rows={12}
              className={field}
              defaultValue={content?.text}
            />
          </label>
          <label>
            本站整理摘要
            <textarea
              name="summary"
              maxLength={10000}
              rows={5}
              className={field}
              defaultValue={content?.summary}
            />
          </label>
          <label>
            适用人群与条件限制
            <textarea
              name="audience"
              maxLength={3000}
              rows={5}
              className={field}
              defaultValue={content?.audience}
            />
          </label>
          <p className="text-sm sm:col-span-2">
            日期格式为YYYY-MM-DD，或YYYY-MM-DDTHH:mm:ss+08:00。不能推测截止时刻；每项日期须引用原文片段。
          </p>
          {TIMELINE_LABELS.map((label, index) => (
            <div key={label} className="grid gap-2 rounded border p-3">
              <label>
                {label}
                <input
                  name={`time${index}`}
                  maxLength={40}
                  className={field}
                  defaultValue={content?.timeline.find((t) => t.label === label)?.value}
                />
              </label>
              <label>
                结束时间（可选，用于多日考试或时间范围）
                <input
                  name={`timeEnd${index}`}
                  maxLength={40}
                  className={field}
                  defaultValue={content?.timeline.find((t) => t.label === label)?.endValue}
                />
              </label>
              <label>
                对应原文引用
                <textarea
                  name={`quote${index}`}
                  maxLength={2000}
                  className={field}
                  defaultValue={content?.timeline.find((t) => t.label === label)?.quote}
                />
              </label>
            </div>
          ))}
          <label className="sm:col-span-2">
            附件（每行：名称|HTTPS官方地址）
            <textarea
              name="attachments"
              rows={3}
              className={field}
              defaultValue={content?.attachments.map((a) => `${a.name}|${a.url}`).join("\n")}
            />
          </label>
          <label>
            关联更正 / 原公告ID（可空）
            <input name="relatedId" className={field} defaultValue={content?.relatedId} />
          </label>
          <button
            disabled={busy}
            className="self-end rounded bg-primary p-3 text-primary-foreground"
          >
            保存为草稿，暂不发布
          </button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">公告与待审核版本</h2>
        {data.notices.map((item) => (
          <article className="space-y-3 rounded border p-4" key={item.id}>
            <h3 className="font-semibold">{item.content.title}</h3>
            <p className="text-sm">
              {item.status} · 最新v{item.version} · 已发布
              {item.published_version ? `v${item.published_version}` : "无"} · {item.content.region}{" "}
              · {item.content.edition}
            </p>
            <p className="text-xs">
              ID：{item.id} · {item.canonical_url}
            </p>
            <details>
              <summary>预览原文与结构化内容</summary>
              <pre className="max-h-96 overflow-auto text-sm whitespace-pre-wrap">
                {JSON.stringify(item.content, null, 2)}
              </pre>
            </details>
            <div className="flex flex-wrap gap-3">
              <button className="rounded border p-2" onClick={() => setEditing(item)}>
                核对 / 修改
              </button>
              <button
                disabled={busy}
                className="rounded border p-2"
                onClick={() => void act({ action: "publish", id: item.id, version: item.version })}
              >
                已核对，发布此版本
              </button>
              <button
                disabled={busy}
                className="rounded border p-2"
                onClick={() => void act({ action: "withdraw", id: item.id, version: item.version })}
              >
                撤回公开展示
              </button>
            </div>
          </article>
        ))}
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">最近采集记录（最多100条）</h2>
        {data.runs.map((run) => (
          <p className="my-2 rounded border p-3 text-sm" key={run.id}>
            {run.started_at} · {data.sources.find((s) => s.id === run.source_id)?.name} ·{" "}
            {run.status} · {run.message}
          </p>
        ))}
      </section>
    </div>
  );
}
