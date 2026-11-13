"use client";

import { useRef } from "react";
import { DemoControls } from "@/components/demo-controls";
import type { ReactElement } from "react";

export function QuickGuide(): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function close(): void {
    dialog.current?.close();
    try {
      localStorage.setItem("material-review-guide-seen", "1");
    } catch {
      /* Optional preference. */
    }
    trigger.current?.focus();
  }
  return (
    <>
      <button
        ref={trigger}
        onClick={() => dialog.current?.showModal()}
        className="min-h-11 rounded-lg border bg-card px-4 text-sm text-primary"
      >
        怎么用 · 3步上手
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="guide-heading"
        onCancel={close}
        className="m-auto max-h-[90vh] w-[min(92vw,640px)] overflow-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-slate-950/45"
      >
        <h2 id="guide-heading" className="text-xl font-semibold">
          三步完成一次材料预审
        </h2>
        <ol className="my-6 space-y-5 text-sm leading-7">
          <li>
            <strong>1. 准备要求与材料</strong>
            <p>通知、指南放在“审查依据”，要提交的文件放在“待审查材料”。选择文件后自动读取。</p>
          </li>
          <li>
            <strong>2. 点击主按钮开始</strong>
            <p>系统自动整理审查要求，再逐项检查。有疑问时集中补充，也可跳过后先查独立项。</p>
          </li>
          <li>
            <strong>3. 处理问题并导出</strong>
            <p>点开问题核对依据，在问题旁修订材料，再复查受影响项。确认范围后导出报告。</p>
          </li>
        </ol>
        <DemoControls autoRun forceMock />
        <button
          className="min-h-11 rounded-lg bg-primary px-5 text-sm font-medium text-white"
          onClick={close}
        >
          跳过 / 关闭引导
        </button>
      </dialog>
    </>
  );
}
