"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
export function LearningActions({
  id,
  saved = false,
  seen = false,
  dismissed = false,
}: {
  id: string;
  saved?: boolean;
  seen?: boolean;
  dismissed?: boolean;
}): ReactElement {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    router = useRouter();
  async function act(field: string, value: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark", id, field, value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("已保存。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-4">
        <button disabled={busy} className="underline" onClick={() => void act("saved", !saved)}>
          {saved ? "取消资料收藏" : "收藏资料"}
        </button>
        <button disabled={busy} className="underline" onClick={() => void act("seen", !seen)}>
          {seen ? "取消已看" : "标记已看"}
        </button>
        <button
          disabled={busy}
          className="underline"
          onClick={() => void act("dismissed", !dismissed)}
        >
          {dismissed ? "恢复推荐" : "不感兴趣"}
        </button>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
export function LearningPreferences({
  personalized,
  retainChat,
}: {
  personalized: boolean;
  retainChat: boolean;
}): ReactElement {
  const [message, setMessage] = useState(""),
    router = useRouter();
  return (
    <form
      className="flex flex-wrap gap-4 rounded border p-4 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        try {
          const response = await fetch("/api/learning", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "preferences",
              personalized: values.has("personalized"),
              retainChat: values.has("retainChat"),
            }),
          });
          if (!response.ok) throw new Error("保存失败。");
          setMessage("偏好已保存。");
          router.refresh();
        } catch {
          setMessage("保存失败，请重试。");
        }
      }}
    >
      <label>
        <input type="checkbox" name="personalized" defaultChecked={personalized} /> 按目标推荐
      </label>
      <label>
        <input type="checkbox" name="retainChat" defaultChecked={retainChat} /> 保存本站助手会话历史
      </label>
      <button className="underline">保存偏好</button>
      <p role="status">{message}</p>
      <p className="w-full text-xs text-muted-foreground">
        关闭个性化可浏览通用已审核资源；聊天关闭保存后仍可能产生外部模型调用记录，历史会话可在助手中单独删除。
      </p>
    </form>
  );
}
