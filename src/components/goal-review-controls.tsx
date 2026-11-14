"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
export function GoalReviewControls({
  goalId,
  enabled,
  taskId,
  dailyLimit = 5,
}: {
  goalId: string;
  enabled: boolean;
  taskId: string | null;
  dailyLimit?: number;
}): ReactElement {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    router = useRouter();
  async function act(
    auto: boolean,
    pause = false,
    stage = "报名材料准备",
    adopt = false,
    checkNow = false,
    retryFailed = false,
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/goals/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId, auto, pause, stage, adopt, checkNow, retryFailed }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMessage(
        checkNow
          ? "已检查自动执行条件；不满足条件、重复或超限时不启动，记录请在下方核对。"
          : adopt
            ? "已明确采用当前发布版本，请进入材料任务重新提取并核对规则。"
            : pause
              ? "已关闭自动执行，并请求取消正在运行的自动审查。"
              : "已绑定材料任务，请先提取并核对规则、上传材料。自动检测周期约一分钟。",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">目标材料预审 · 自动执行{enabled ? "已开启" : "未开启"}</h2>
      <p className="text-sm">
        开启后，本目标已核对规则及材料版本变化会触发审查，可能调用已配置模型并产生费用。每账号最近24小时最多
        {dailyLimit}
        次自动任务，同一快照不重复执行；公告新版须先明确采用。附件未导入、规则缺失时不会假装已审查。
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void act(values.has("auto"), false, String(values.get("stage")));
        }}
      >
        <label>
          本次材料阶段
          <input
            required
            name="stage"
            maxLength={80}
            defaultValue="报名材料准备"
            className="ml-2 rounded border p-2"
          />
        </label>
        <label className="block">
          <input name="auto" type="checkbox" defaultChecked={enabled} />{" "}
          我同意按上述范围自动预审及模型耗用
        </label>
        <button disabled={busy} className="underline">
          {taskId ? "更新绑定与授权" : "建立目标材料任务"}
        </button>
      </form>
      {taskId && (
        <a href={`/tasks/${taskId}`} className="inline-block underline">
          进入材料任务：核对规则、上传材料、查看证据与复检
        </a>
      )}
      <button disabled={busy} className="ml-4 underline" onClick={() => void act(false, true)}>
        关闭自动执行 / 取消在途自动审查
      </button>
      <button
        disabled={busy || !enabled}
        className="block underline"
        onClick={() => void act(enabled, false, "报名材料准备", false, true)}
      >
        现在检查自动执行条件
      </button>
      <button
        disabled={busy}
        className="block underline"
        onClick={() => void act(enabled, false, "报名材料准备", true)}
      >
        我已核对差异，明确采用当前公告版本
      </button>
      <button
        disabled={busy || !enabled}
        className="block underline"
        onClick={() => void act(enabled, false, "报名材料准备", false, true, true)}
      >
        重试失败或已取消的自动预审（仍计入24小时{dailyLimit}次限额）
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
