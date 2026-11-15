"use client";
import { useEffect, useState } from "react";
import { Bookmark, Check, Eye, EyeOff } from "lucide-react";
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
  useEffect(() => {
    if (message !== "已保存。") return;
    const timer = setTimeout(() => setMessage(""), 2200);
    return () => clearTimeout(timer);
  }, [message]);
  async function act(field: string, value: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage("");
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
        <button
          disabled={busy}
          className="button-secondary"
          aria-pressed={saved}
          onClick={() => void act("saved", !saved)}
        >
          <Bookmark size={16} aria-hidden="true" />
          {saved ? "已收藏" : "收藏资料"}
        </button>
        <button
          disabled={busy}
          className="button-secondary"
          aria-pressed={seen}
          onClick={() => void act("seen", !seen)}
        >
          <Check size={16} aria-hidden="true" />
          {seen ? "已看" : "未看"}
        </button>
        <button
          disabled={busy}
          className="button-secondary"
          onClick={() => void act("dismissed", !dismissed)}
        >
          {dismissed ? (
            <Eye size={16} aria-hidden="true" />
          ) : (
            <EyeOff size={16} aria-hidden="true" />
          )}
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
  externalEnabled = true,
}: {
  personalized: boolean;
  retainChat: boolean;
  externalEnabled?: boolean;
}): ReactElement {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (message !== "偏好已保存。") return;
    const timer = setTimeout(() => setMessage(""), 2200);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const show = (): void => {
      if (location.hash === "#assistant-privacy") setOpen(true);
    };
    show();
    window.addEventListener("hashchange", show);
    return () => window.removeEventListener("hashchange", show);
  }, []);
  return (
    <details
      className="surface"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="goal-summary font-medium">学习偏好</summary>
      <form
        key={open ? "editing" : "closed"}
        className="preferences-panel surface"
        aria-label="学习与隐私偏好"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const values = new FormData(event.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/learning", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "preferences",
                personalized: values.has("personalized"),
                retainChat: values.has("retainChat"),
                externalEnabled: values.has("externalEnabled"),
              }),
            });
            if (!response.ok) throw new Error("保存失败");
            setMessage("偏好已保存。");
            router.refresh();
          } catch {
            setMessage("保存失败，请重试。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-4">
          <h2 className="font-semibold">学习偏好</h2>
          <p className="mt-1 text-sm text-muted-foreground">选择适合你的推荐与会话方式。</p>
        </div>
        <div className="preference-options">
          <label>
            <input type="checkbox" name="personalized" defaultChecked={personalized} />
            按目标推荐
          </label>
          <label>
            <input type="checkbox" name="retainChat" defaultChecked={retainChat} />
            保存本站助手会话历史
          </label>
        </div>
        <details className="mt-4 text-sm" id="assistant-privacy" open>
          <summary>AI与隐私设置</summary>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" name="externalEnabled" defaultChecked={externalEnabled} />
            使用AI生成回答
          </label>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            开启后，你的问题、选定考试范围及相关公开资料将发送至模型服务，不自动发送私人材料。关闭后仅检索本站资料。关闭会话保存不影响服务商的处理记录，已有会话可在助手中单独删除。
          </p>
        </details>
        <div className="preference-footer">
          <p role="status" aria-live="polite">
            {message}
          </p>
          <button className="button-primary" disabled={busy}>
            {busy ? "保存中…" : "保存偏好"}
          </button>
        </div>
      </form>
    </details>
  );
}
