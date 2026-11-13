"use client";
import { useState } from "react";
import type { ReactElement } from "react";
export function TaskAccess({ taskId }: { taskId: string }): ReactElement {
  const [users, setUsers] = useState<string[]>([]);
  const [grants, setGrants] = useState<string[]>([]);
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
      setUsers(payload.users);
      setGrants(payload.grants);
      setOwner(payload.owner);
      if (!payload.users.length) setMessage("当前为单机模式。配置本地访问身份后可按任务授权。");
    } catch {
      setMessage("无法读取授权。");
    }
  }
  async function toggle(userId: string, enabled: boolean): Promise<void> {
    try {
      const response = await fetch(`/api/tasks/${taskId}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, enabled }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error);
        return;
      }
      setGrants(payload.grants);
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
        所有者可授予已配置身份本任务的查看、编辑、检查与导出权限；授权管理由所有者控制。已经下载的副本无法撤回。
      </p>
      {users
        .filter((user) => user !== owner)
        .map((user) => (
          <label key={user} className="my-2 block text-sm">
            <input
              type="checkbox"
              checked={grants.includes(user)}
              onChange={(event) => void toggle(user, event.target.checked)}
            />{" "}
            授权 {user}
          </label>
        ))}
      <p role="status" className="text-xs">
        {message}
      </p>
    </details>
  );
}
