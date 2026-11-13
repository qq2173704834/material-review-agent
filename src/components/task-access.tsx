"use client";
import { useState } from "react";
import type { ReactElement } from "react";
export function TaskAccess({ taskId }: { taskId: string }): ReactElement {
  const [users, setUsers] = useState<string[]>([]);
  const [grants, setGrants] = useState<string[]>([]);
  const [legacy, setLegacy] = useState(true);
  const [username, setUsername] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [owner, setOwner] = useState("");
  const [message, setMessage] = useState("");
  async function load(): Promise<void> {
    try {
      const response = await fetch(`/api/tasks/${taskId}/access`);
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error);
        return;
      }
      setLegacy(payload.legacy ?? true);
      setLabels(payload.labels ?? {});
      setUsers(payload.users);
      setGrants(payload.grants);
      setOwner(payload.owner);
      if (payload.legacy && !payload.users.length)
        setMessage("当前为单机模式。配置本地访问身份后可按任务授权。");
    } catch {
      setMessage("无法读取授权。");
    }
  }
  async function toggle(userId: string, enabled: boolean, byUsername = false): Promise<void> {
    try {
      const response = await fetch(`/api/tasks/${taskId}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(byUsername ? { username: userId, enabled } : { userId, enabled }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error);
        return;
      }
      setGrants(payload.grants);
      if (!legacy) await load();
      setMessage("任务授权已更新；撤销后对方的新请求将被拒绝。");
    } catch {
      setMessage("授权保存失败。");
    }
  }
  return (
    <details
      className="my-4 max-w-4xl rounded border p-3"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary className="cursor-pointer text-sm">任务访问授权</summary>
      <p className="my-2 text-xs">
        所有者可授予明确账号本任务的查看、编辑、检查与导出权限；授权管理由所有者控制。已经下载的副本无法撤回。
      </p>
      {!legacy && (
        <div className="flex gap-2">
          <input
            aria-label="被授权用户名"
            placeholder="对方的准确用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="rounded border p-2"
          />
          <button type="button" onClick={() => void toggle(username, true, true)}>
            添加授权
          </button>
        </div>
      )}
      {users
        .filter((user) => user !== owner)
        .map((user) => (
          <label key={user} className="my-2 block text-sm">
            <input
              type="checkbox"
              checked={grants.includes(user)}
              onChange={(event) => void toggle(user, event.target.checked)}
            />{" "}
            授权 {labels[user] ?? user}
          </label>
        ))}
      <p role="status" className="text-xs">
        {message}
      </p>
    </details>
  );
}
