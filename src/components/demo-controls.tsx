"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { demoCases } from "@/lib/demo-cases";
import type { DemoDomain } from "@/lib/demo-cases";
import type { ReactElement } from "react";

export function DemoControls({
  taskId,
  domain,
}: {
  taskId?: string;
  domain?: DemoDomain;
}): ReactElement {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function create(selected: DemoDomain, revision = false): Promise<void> {
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
      } else router.push(`/tasks/${payload.taskId}`);
    } catch {
      setMessage("本地服务连接失败，请稍后重试。");
    } finally {
      setIsBusy(false);
    }
  }
  return (
    <section className="my-5 rounded-md border border-border p-4" aria-label="合成案例演示">
      <p className="text-xs text-muted-foreground">
        合成演示数据 ·
        创建独立案例，可从初始问题走到修订复检。检查使用当前配置的模拟或真实模型，并明确显示模式。
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
          (Object.keys(demoCases) as DemoDomain[]).map((key) => (
            <button
              className="min-h-11 rounded border px-3 text-xs"
              key={key}
              disabled={isBusy}
              onClick={() => create(key)}
            >
              创建{demoCases[key].name}
            </button>
          ))
        )}
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
