"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import { searchCampusSchools, hasCampusNoticeSource } from "@/domain/campus-schools";
export function CampusSchoolRequest({
  onSelectSchool,
}: {
  onSelectSchool: (id: string) => Promise<boolean>;
}): ReactElement {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState("");
  const query = name.trim().replace(/\s+/gu, "");
  const result = query.length >= 2 ? searchCampusSchools(query, "", 8) : { schools: [], total: 0 };
  const matches = result.schools;
  return (
    <details className="rounded-xl border bg-card p-4 text-sm">
      <summary className="cursor-pointer text-primary">没有找到学校？申请添加学校</summary>
      <p className="mt-3 text-muted-foreground">
        先输入学校名称查找；尚未收录的学校可提交添加申请，由维护人员核对后补充。
      </p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || matches.length) return;
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setMessage("");
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
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setMessage("");
            }}
            required
            minLength={2}
            maxLength={100}
            placeholder="输入学校全名或简称"
            className="mt-1 min-h-11 w-full rounded-lg border p-2"
          />
        </label>
        {!!matches.length && (
          <div className="space-y-2 sm:col-span-2">
            <p className="text-muted-foreground">已找到以下学校，可直接选择：</p>
            {result.total > 8 && (
              <p className="text-xs text-muted-foreground">
                共找到{result.total}所，先显示8所，请继续输入学校名称。
              </p>
            )}
            {matches.map((school) => (
              <div key={school.id} className="space-y-1">
                <button
                  type="button"
                  disabled={busy}
                  className="button-secondary"
                  onClick={async () => {
                    setBusy(true);
                    setMessage("");
                    try {
                      setMessage(
                        (await onSelectSchool(school.id))
                          ? hasCampusNoticeSource(school.id)
                            ? `已选择${school.name}，可查看本校通知。`
                            : `已选择${school.name}，可查看学校信息或管理个人日程。`
                          : "选择失败，请重试。",
                      );
                    } catch {
                      setMessage("选择失败，请重试。");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  选择{school.name}
                </button>
                <p className="text-xs text-muted-foreground">
                  {school.province} · {school.level} · {school.status}
                </p>
              </div>
            ))}
          </div>
        )}
        {!matches.length && (
          <>
            <label>
              学校官网（选填）
              <input
                name="url"
                type="url"
                maxLength={2000}
                placeholder="知道官网时可填写 https://…"
                className="mt-1 min-h-11 w-full rounded-lg border p-2"
              />
            </label>
            <button disabled={busy} className="button-secondary">
              {busy ? "提交中…" : "申请添加学校"}
            </button>
          </>
        )}
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
