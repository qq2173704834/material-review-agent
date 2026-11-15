"use client";
import { useEffect, useState } from "react";
import type { CampusNotice } from "@/domain/campus";
import type { ReactElement } from "react";
interface Source {
  id: string;
  department: string;
  schoolId: string;
  url: string;
  settings?: { enabled: number; interval_hours: number };
  run?: { last_success: string; error: string; next_run: number };
}
export function CampusAdmin(): ReactElement {
  const [sources, setSources] = useState<Source[]>([]),
    [requests, setRequests] = useState<Array<{ name: string; url: string; created_at: string }>>(
      [],
    ),
    [notices, setNotices] = useState<CampusNotice[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(): Promise<void> {
    const response = await fetch("/api/admin/campus");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setSources(result.sources);
    setRequests(result.requests);
    setNotices(result.notices);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/campus", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setSources(result.sources);
        setRequests(result.requests);
        setNotices(result.notices);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, []);
  async function command(body: unknown): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/campus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.count === undefined ? "设置已保存" : `成功读取${result.count}篇通知`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">校园来源维护</h1>
      <p role="status">{message}</p>
      {sources.map((source) => (
        <form
          key={source.id}
          className="space-y-3 rounded-xl border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void command({
              action: "settings",
              id: source.id,
              enabled: form.get("enabled") === "on",
              intervalHours: Number(form.get("interval")),
            });
          }}
        >
          <h2 className="font-medium">
            {source.schoolId} · {source.department}
          </h2>
          <a
            className="break-all text-sm text-primary underline"
            href={source.url}
            target="_blank"
            rel="noreferrer"
          >
            {source.url}
          </a>
          <p className="text-sm">
            最近成功：{source.run?.last_success || "尚无运行记录"} · {source.run?.error || ""}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label>
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={source.settings?.enabled !== 0}
              />
              启用定期检查
            </label>
            <label>
              间隔小时
              <input
                name="interval"
                type="number"
                min={6}
                max={168}
                defaultValue={source.settings?.interval_hours || 6}
                className="ml-2 min-h-11 w-20 rounded-lg border p-2"
              />
            </label>
            <button disabled={busy} className="button-secondary">
              保存配置
            </button>
            <button
              type="button"
              disabled={busy}
              className="button-secondary"
              onClick={() => void command({ action: "collect", id: source.id })}
            >
              检查此来源
            </button>
          </div>
        </form>
      ))}
      <h2 className="font-semibold">通知状态维护</h2>
      {notices.map((notice) => (
        <article
          key={notice.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
        >
          <span className="text-sm">
            {notice.title} · {notice.withdrawn ? "已撤回" : "展示中"}
          </span>
          <button
            disabled={busy}
            className="button-secondary"
            onClick={() =>
              void command({ action: "moderate", id: notice.id, withdrawn: !notice.withdrawn })
            }
          >
            {notice.withdrawn ? "恢复展示" : "撤回通知"}
          </button>
        </article>
      ))}
      <h2 className="font-semibold">学校添加申请</h2>
      {requests.map((request, index) => (
        <p key={index} className="rounded border p-3 text-sm">
          {request.name} ·{" "}
          {request.url ? (
            <a href={request.url} target="_blank" rel="noreferrer" className="break-all underline">
              {request.url}
            </a>
          ) : (
            <span className="text-muted-foreground">未提供官网</span>
          )}{" "}
          · {request.created_at.slice(0, 10)}
        </p>
      ))}
    </section>
  );
}
