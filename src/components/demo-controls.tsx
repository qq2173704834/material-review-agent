"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { demoCases } from "@/lib/demo-cases";
import type { DemoDomain } from "@/lib/demo-cases";
import type { ReactElement } from "react";

export function DemoControls({
  taskId,
  domain,
  autoRun = false,
  forceMock = false,
}: {
  taskId?: string;
  domain?: DemoDomain;
  autoRun?: boolean;
  forceMock?: boolean;
}): ReactElement {
  const router = useRouter();
  const busy = useRef(false);
  const [createdTaskId, setCreatedTaskId] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const create = useCallback(
    async (selected: DemoDomain, revision = false): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      setIsBusy(true);
      setMessage("");
      try {
        const response = await fetch("/api/demos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: selected, ...(revision ? { taskId } : {}) }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setMessage(payload.error ?? "创建失败，请重试。");
          return;
        }
        if (revision) {
          setMessage("修订材料已载入，请复检查看真实变化。");
          router.refresh();
        } else {
          setCreatedTaskId(payload.taskId);
          if (autoRun) {
            setMessage("独立示例已创建，正在按当前模式整理要求并执行审查…");
            const rules = await fetch(
              `/api/tasks/${payload.taskId}/rules?prepare=1${forceMock ? "&mode=mock" : ""}`,
              {
                method: "POST",
              },
            );
            if (!rules.ok) {
              setMessage(
                "示例已保存，但当前模式无法整理要求。请打开示例查看配置或重试；未自动切换模拟模式。",
              );
              return;
            }
            const check = await fetch(
              `/api/tasks/${payload.taskId}/checks${forceMock ? "?mode=mock" : ""}`,
              { method: "POST" },
            );
            if (!check.ok) {
              setMessage("示例已保存，检查未启动。可打开示例继续，未预置审查成绩。");
              return;
            }
            await check.text();
          }
          router.push(
            `/tasks/${payload.taskId}${autoRun ? `?view=results${forceMock ? "&mode=mock" : ""}` : ""}`,
          );
        }
      } catch {
        setMessage("服务连接失败，请稍后重试。");
      } finally {
        busy.current = false;
        setIsBusy(false);
      }
    },
    [router, taskId, autoRun, forceMock],
  );
  return (
    <section className="my-5 rounded-md border border-border p-4" aria-label="合成案例演示">
      <p className="text-xs text-muted-foreground">
        合成演示数据 ·
        {forceMock
          ? "演示模式 · 新建独立案例，体验检查与修订复检。"
          : "新建独立案例，体验发现问题、修改材料与重新检查。"}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {domain && taskId ? (
          <>
            <button
              className="min-h-11 rounded border px-3 text-xs"
              disabled={isBusy}
              onClick={() => create(domain, true)}
            >
              载入演示修订材料
            </button>
            <button
              className="min-h-11 rounded border px-3 text-xs"
              disabled={isBusy}
              onClick={() => create(domain)}
            >
              重新创建初始案例
            </button>
          </>
        ) : (
          <>
            <button
              className="min-h-11 rounded border px-3 text-xs"
              disabled={isBusy}
              onClick={() => create("competition")}
            >
              {autoRun ? "创建并审查" : "创建"}
              {demoCases.competition.name}
            </button>
            <button
              className="min-h-11 rounded border px-3 text-xs"
              disabled={isBusy}
              onClick={() => create("grant")}
            >
              {autoRun ? "创建并审查" : "创建"}
              {demoCases.grant.name}
            </button>
          </>
        )}
      </div>
      {createdTaskId && (
        <a
          className="my-2 inline-flex min-h-11 items-center text-xs text-primary underline"
          href={`/tasks/${createdTaskId}`}
        >
          打开已创建的独立示例
        </a>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
