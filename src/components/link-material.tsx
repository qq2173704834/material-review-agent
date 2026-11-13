"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
export function LinkMaterial({ taskId }: { taskId: string }): ReactElement {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [repository, setRepository] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name, repository }),
      });
      const payload = await response.json();
      setMessage(response.ok ? `${payload.material.parseMessage}` : payload.error);
      if (response.ok) router.refresh();
    } catch {
      setMessage("网络失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="my-4 max-w-4xl rounded border p-3 text-sm">
      <summary className="min-h-11 cursor-pointer">添加链接 / 公开代码仓库材料</summary>
      <label>
        名称
        <input
          className="block min-h-11 w-full rounded border p-2"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        公开URL
        <input
          className="block min-h-11 w-full rounded border p-2"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={repository}
          onChange={(event) => setRepository(event.target.checked)}
        />
        获取公开GitHub仓库 README、依赖与配置模板（不执行代码）
      </label>
      <button
        disabled={busy || !url || !name}
        className="min-h-11 rounded border px-3"
        onClick={() => void save()}
      >
        {busy ? "正在读取…" : "读取并保存链接材料"}
      </button>
      <p role="status" className="whitespace-pre-wrap text-xs">
        {message}
      </p>
    </details>
  );
}
