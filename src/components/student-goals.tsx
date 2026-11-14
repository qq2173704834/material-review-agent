"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EXAM_CATEGORIES, EXAM_GROUPS, EXAM_REGIONS, CATEGORY_LABELS } from "@/domain/exam-catalog";
import type { StudentGoal } from "@/domain/student-goal";
import type { ExamNotice } from "@/lib/server/exam-store";
export function StudentGoals({
  goals,
  notices,
  newCategory,
  noticeId,
}: {
  goals: StudentGoal[];
  notices: ExamNotice[];
  newCategory?: string;
  noticeId?: string;
}): ReactElement {
  const router = useRouter(),
    [editing, setEditing] = useState<StudentGoal | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = notices.find((item) => item.id === noticeId);
  const [category, setCategory] = useState(newCategory ?? selected?.content.category ?? "cet4");
  async function save(form: HTMLFormElement): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const values = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing?.id,
          goal: {
            ...values,
            minutesPerDay: Number(values.minutesPerDay ?? 0),
            formats: new FormData(form).getAll("formats"),
            ...(values.noticeId ? {} : { noticeId: undefined }),
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("考试目标已保存。");
      setEditing(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="goals" className="space-y-5">
      <h2 className="text-xl font-semibold">我的考试目标</h2>
      <p className="text-sm text-muted-foreground">
        可同时关注不同考试；专业、考期和地区条件仍以当期公告为准。
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {!goals.length && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground md:col-span-2">
            还没有考试目标。展开下方“添加考试目标”，或从考试中心选择公告，即可开始记录备考进度。
          </p>
        )}
        {goals.map((goal) => (
          <article key={goal.id} className="space-y-2 rounded-xl border p-4">
            <h3 className="font-semibold">
              {CATEGORY_LABELS[goal.category]} · {goal.edition}
            </h3>
            <p>
              {goal.region} · {goal.subject || "科目/岗位待确认"} ·{" "}
              {goal.state === "active" ? "备考中" : goal.state === "paused" ? "已暂停" : "已归档"}
            </p>
            <p className="text-sm">
              {goal.studyStage} ·{" "}
              {goal.minutesPerDay ? `每天${goal.minutesPerDay}分钟` : "时间未设定"}
            </p>
            <p className="text-sm">{goal.progress || "暂无个人进度记录"}</p>
            <details>
              <summary>清除目标</summary>
              <p>仅清除目标与对应自动计划；历史材料任务、结果和收藏保留。</p>
              <button
                disabled={busy}
                className="underline"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const response = await fetch("/api/goals", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: goal.id }),
                    });
                    if (!response.ok) throw new Error("清除失败");
                    router.refresh();
                    setMessage("目标已清除，历史任务可从材料预审入口查看。");
                  } catch {
                    setMessage("清除失败，请重试。");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认清除此目标
              </button>
            </details>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link className="underline" href={`/learn?goal=${goal.id}`}>
                目标学习资源
              </Link>
              <Link className="underline" href={`/me/goals/${goal.id}`}>
                材料准备与预审
              </Link>
              <button
                className="underline"
                onClick={() => {
                  setEditing(goal);
                  setCategory(goal.category);
                }}
              >
                编辑目标
              </button>
            </div>
          </article>
        ))}
      </div>
      <details
        open={!!(newCategory || noticeId || editing)}
        className="rounded-xl border bg-card p-5"
      >
        <summary className="cursor-pointer font-medium">
          {editing ? "编辑考试目标" : "添加考试目标"}
        </summary>
        <form
          key={editing?.id ?? noticeId ?? "new"}
          onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget);
          }}
          className="mt-5 grid gap-4 sm:grid-cols-2"
        >
          <label>
            考试类别
            <select
              name="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1 w-full rounded border p-2"
            >
              {EXAM_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {EXAM_CATEGORIES.filter((item) => item[2] === group).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            适用地区
            <select
              name="region"
              defaultValue={editing?.region ?? selected?.content.region ?? "全国"}
              className="mt-1 w-full rounded border p-2"
            >
              {EXAM_REGIONS.map((region) => (
                <option key={region}>{region}</option>
              ))}
            </select>
          </label>
          <label>
            考期
            <input
              name="edition"
              maxLength={80}
              defaultValue={editing?.edition ?? selected?.content.edition ?? "待确认考期"}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            级别 / 科目 / 岗位
            <input
              name="subject"
              maxLength={120}
              defaultValue={editing?.subject}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            关联公告
            <select
              name="noticeId"
              defaultValue={editing?.noticeId ?? noticeId ?? ""}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="">先关注，稍后确认公告</option>
              {notices
                .filter(
                  (item) =>
                    item.content.category === category ||
                    item.content.categories?.some((id) => id === category) ||
                    ((category === "cet4" || category === "cet6") &&
                      (item.content.category === "cet4" || item.content.category === "cet6") &&
                      /四、六级|四六级|四级.*六级/.test(item.content.title)),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.content.title} · {item.content.region} · v{item.version}
                  </option>
                ))}
            </select>
          </label>
          <label>
            目标状态
            <select
              name="state"
              defaultValue={editing?.state ?? "active"}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="active">备考中</option>
              <option value="paused">暂停</option>
              <option value="archived">归档</option>
            </select>
          </label>
          <label>
            备考阶段
            <select
              name="studyStage"
              defaultValue={editing?.studyStage ?? "入门"}
              className="mt-1 w-full rounded border p-2"
            >
              {["入门", "基础", "强化", "冲刺"].map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <label>
            每天可投入分钟
            <input
              name="minutesPerDay"
              type="number"
              min={0}
              max={720}
              defaultValue={editing?.minutesPerDay ?? 0}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            学习基础（选填）
            <input
              name="foundation"
              maxLength={200}
              defaultValue={editing?.foundation}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            目标分数（选填）
            <input
              name="targetScore"
              maxLength={80}
              defaultValue={editing?.targetScore}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <label>
            专业 / 年级（选填）
            <input
              name="education"
              maxLength={120}
              defaultValue={editing?.education}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <fieldset>
            <legend>资源形式偏好（选填）</legend>
            <div className="flex flex-wrap gap-3">
              {["考纲", "课程", "资料", "练习", "资讯"].map((format) => (
                <label key={format}>
                  <input
                    type="checkbox"
                    name="formats"
                    value={format}
                    defaultChecked={editing?.formats.includes(
                      format as StudentGoal["formats"][number],
                    )}
                  />{" "}
                  {format}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            个人进度
            <input
              name="progress"
              maxLength={1000}
              defaultValue={editing?.progress}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <div className="flex items-center gap-4">
            <button
              disabled={busy}
              className="rounded bg-primary px-4 py-2 text-primary-foreground"
            >
              {busy ? "保存中…" : "保存目标"}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(null)} className="underline">
                取消编辑
              </button>
            )}
          </div>
        </form>
      </details>
      <p role="status">{message}</p>
    </section>
  );
}
