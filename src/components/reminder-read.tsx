"use client";
import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
export function ReminderRead({ id, version }: { id: string; version: number }): ReactElement {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="rounded border px-2 py-1 text-sm"
        onClick={async () => {
          setPending(true);
          try {
            const response = await fetch("/api/reminders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, version }),
            });
            setMessage(response.ok ? "提醒已读" : "保存失败或版本已变，请刷新重试。");
            if (response.ok) router.refresh();
          } catch {
            setMessage("保存失败，请重试。");
          } finally {
            setPending(false);
          }
        }}
      >
        标记提醒已读
      </button>
      <span role="status">{message}</span>
    </span>
  );
}
