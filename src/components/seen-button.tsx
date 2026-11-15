"use client";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function SeenButton({ id }: { id: string }): ReactElement {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={isSaving}
        className="rounded border p-2"
        onClick={async () => {
          setIsSaving(true);
          try {
            const response = await fetch(`/api/exams/${id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "seen" }),
            });
            setMessage(response.ok ? "已标为已读" : "保存失败，请重试");
            if (response.ok) router.refresh();
          } catch {
            setMessage("保存失败，请重试");
          } finally {
            setIsSaving(false);
          }
        }}
      >
        标为已读
      </button>
      <span role="status">{message}</span>
    </>
  );
}
