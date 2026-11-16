"use client";
import { useEffect, useRef, useState } from "react";
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
    <div className="resource-actions space-y-2 text-sm">
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
  const received = { personalized, retainChat, externalEnabled };
  const signature = JSON.stringify(received);
  const [previous, setPrevious] = useState(signature);
  const [baseline, setBaseline] = useState(received);
  const [draft, setDraft] = useState(received);
  const pending = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  if (signature !== previous) {
    setPrevious(signature);
    setBaseline(received);
    if (!dirty) setDraft(received);
  }
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
        className="preferences-panel surface"
        aria-label="学习与隐私偏好"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          const submitted = { ...draft };
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/learning", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "preferences",
                personalized: submitted.personalized,
                retainChat: submitted.retainChat,
                externalEnabled: submitted.externalEnabled,
              }),
            });
            if (!response.ok) throw new Error("保存失败");
            setBaseline(submitted);
            setMessage("偏好已保存。");
            router.refresh();
          } catch {
            setMessage("保存失败，请重试。");
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="mb-4">
          <h2 className="font-semibold">学习偏好</h2>
        </div>
        <div className="preference-options">
          <label>
            <input
              type="checkbox"
              name="personalized"
              disabled={busy}
              checked={draft.personalized}
              onChange={(event) => setDraft({ ...draft, personalized: event.target.checked })}
            />
            按目标推荐
          </label>
          <label>
            <input
              type="checkbox"
              name="retainChat"
              disabled={busy}
              checked={draft.retainChat}
              onChange={(event) => setDraft({ ...draft, retainChat: event.target.checked })}
            />
            保存会话历史
          </label>
        </div>
        <details className="mt-4 text-sm" id="assistant-privacy" open>
          <summary>AI与隐私设置</summary>
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              name="externalEnabled"
              disabled={busy}
              checked={draft.externalEnabled}
              onChange={(event) => setDraft({ ...draft, externalEnabled: event.target.checked })}
            />
            使用AI生成回答
          </label>
          <details className="mt-2 text-xs leading-6 text-muted-foreground">
            <summary>隐私说明</summary>
            <p>
              开启后，问题、考试范围和相关公开资料会发送至模型服务，私人材料不会自动发送。关闭后仅搜索本站资料。会话可在助手中删除；关闭保存不影响服务商记录。
            </p>
          </details>
        </details>
        <div className="preference-footer">
          <p role="status" aria-live="polite">
            {message}
          </p>
          {dirty && (
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => {
                setDraft(baseline);
                setMessage("");
              }}
            >
              放弃修改
            </button>
          )}
          <button className="button-primary" disabled={busy}>
            {busy ? "保存中…" : "保存偏好"}
          </button>
        </div>
      </form>
    </details>
  );
}
