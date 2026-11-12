"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

export function SourceAttachments({
  taskId,
  sources,
}: {
  taskId: string;
  sources: Array<{ id: string; displayName: string }>;
}): ReactElement | null {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [attachments, setAttachments] = useState<Array<{ url: string; name: string }>>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  if (!sources.length) return null;
  async function load(url?: string): Promise<void> {
    setIsLoading(true);
    setMessage("");
    const endpoint = `/api/tasks/${taskId}/sources/${sourceId}/attachments`;
    try {
      const response = await fetch(
        endpoint,
        url
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url }),
            }
          : { cache: "no-store" },
      );
      const payload = await response.json();
      if (url) {
        setStatus((current) => ({
          ...current,
          [url]: response.ok
            ? payload.reused
              ? "已添加，沿用现有来源"
              : "已获取并保存为补充来源"
            : (payload.error ?? "获取失败"),
        }));
        if (response.ok) router.refresh();
      } else if (response.ok) {
        setAttachments(payload.attachments);
        setMessage(
          payload.attachments.length
            ? "逐个获取后，请更新规则以纳入附件要求。"
            : "未发现直接链接的 PDF、DOCX 或 TXT 附件；请核对原网页或手动上传。",
        );
      } else setMessage(payload.error ?? "获取失败，可改为上传文件。");
    } catch {
      setMessage("网络请求失败，请稍后重试或上传附件。");
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <details className="mt-4 max-w-4xl">
      <summary className="cursor-pointer text-xs text-primary">获取通知关联附件</summary>
      <div className="mt-2 space-y-3 rounded border border-border p-3">
        <p className="text-xs">
          识别网页直接链接的 PDF、DOCX、TXT，最多列出 20 个。每份最多 4 MiB、请求最多 12
          秒；受限页面请手动上传。
        </p>
        <label className="block text-xs">
          附件所在通知
          <select
            aria-label="附件所在通知"
            value={sourceId}
            disabled={isLoading}
            onChange={(event) => {
              setSourceId(event.target.value);
              setAttachments([]);
              setStatus({});
            }}
            className="block min-h-11 max-w-full border p-2"
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={isLoading}
          onClick={() => load()}
          className="min-h-11 rounded border px-3 text-xs"
        >
          {isLoading ? "正在获取…" : "查找关联附件"}
        </button>
        {message && (
          <p role="status" className="text-xs">
            {message}
          </p>
        )}
        <ul className="space-y-2">
          {attachments.map((attachment) => (
            <li key={attachment.url} className="break-all text-xs">
              <a
                className="text-primary underline"
                target="_blank"
                rel="noreferrer"
                href={attachment.url}
              >
                {attachment.name}
              </a>
              <button
                className="ml-2 min-h-11 rounded border px-3"
                disabled={isLoading}
                onClick={() => load(attachment.url)}
              >
                获取此附件
              </button>
              {status[attachment.url] && <p role="status">{status[attachment.url]}</p>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
