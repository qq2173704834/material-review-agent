"use client";
import { useState } from "react";
import type { ReactElement } from "react";
export function CampusSchoolRequest(): ReactElement {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <details className="rounded-xl border bg-card p-4 text-sm">
      <summary className="cursor-pointer text-primary">没有找到学校？提交学校官网</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          try {
            const response = await fetch("/api/campus/school-request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: form.get("name"), url: form.get("url") }),
            });
            const result = await response.json();
            setMessage(result.message || result.error);
          } catch {
            setMessage("提交失败，填写内容已保留。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          学校名称
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            className="mt-1 min-h-11 w-full rounded-lg border p-2"
          />
        </label>
        <label>
          学校官网
          <input
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://"
            className="mt-1 min-h-11 w-full rounded-lg border p-2"
          />
        </label>
        <button disabled={busy} className="button-secondary">
          提交接入建议
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
