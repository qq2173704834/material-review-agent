"use client";
import { editableTaskBackground } from "@/domain/review";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import type { ReviewTaskDetails } from "@/domain/review";
import {
  backgroundSuggestions,
  sensitiveMaterialWarnings,
  similarMaterials,
} from "@/lib/material-insights";

export function MaterialInsights({ task }: { task: ReviewTaskDetails }): ReactElement {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [packageChoices, setPackageChoices] = useState<
    Record<string, { include: boolean; name: string }>
  >({});
  const choiceFor = (id: string, name: string, index: number): { include: boolean; name: string } =>
    packageChoices[id] ?? { include: true, name: `${String(index + 1).padStart(2, "0")}-${name}` };
  const suggestions = backgroundSuggestions(task.materials);
  const sensitive = sensitiveMaterialWarnings(task.materials);
  const similar = similarMaterials(task.materials);
  async function apply(field: string, value: string): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: task.name,
          description: task.description,
          noticeText: task.noticeSource.originalText,
          background: { ...editableTaskBackground(task.background), [field]: value },
        }),
      });
      setMessage(response.ok ? "已人工确认背景建议，相关结果需复检。" : "背景保存失败，请重试。");
      if (response.ok) router.refresh();
    } catch {
      setMessage("连接失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function download(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materials: task.materials.flatMap((material, index) => {
            const choice = choiceFor(material.id, material.originalFileName, index);
            return choice.include
              ? [{ id: material.id, version: material.version, name: choice.name }]
              : [];
          }),
        }),
      });
      if (!response.ok) {
        setMessage((await response.json()).error);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "提交材料包.zip";
      anchor.click();
      // Allow the browser to consume the Blob even when navigation/rendering is busy.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setMessage("导出失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-6 max-w-4xl space-y-4 rounded border p-4" aria-label="材料提示与提交包">
      <h3 className="font-semibold">材料提示与提交准备</h3>
      <p className="text-xs">
        敏感信息仅扫描已解析文字中的常见身份证、手机、邮箱和凭据标记，可能漏检或误报；不会自动删除原文。向外部模型发送前请自行核对。
      </p>
      {sensitive.length > 0 ? (
        <ul className="text-xs text-amber-800">
          {sensitive.map((item, index) => (
            <li key={index}>
              {task.materials.find((material) => material.id === item.materialId)?.originalFileName}{" "}
              v{item.materialVersion} · {item.location} · {item.field}（已遮盖）
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs">未在已解析文字中命中常见敏感标记，不表示不存在敏感信息。</p>
      )}
      {suggestions.map((item, index) => (
        <div key={index} className="rounded bg-muted p-3 text-xs">
          <p>
            可能的背景：
            {{ projectType: "项目类型", projectStage: "项目阶段", collaborationScope: "参与形式" }[
              item.field
            ] ?? item.field}{" "}
            = {item.value === "team" ? "团队" : item.value === "individual" ? "个人" : item.value}
          </p>
          <blockquote>
            {item.quote} · {item.location} · v{item.materialVersion}
          </blockquote>
          <button
            disabled={busy}
            onClick={() => void apply(item.field, item.value)}
            className="min-h-11 text-primary underline"
          >
            确认采用此背景
          </button>
        </div>
      ))}
      {similar.map((pair, index) => (
        <p className="text-xs" key={index}>
          {task.materials.find((item) => item.id === pair.left)?.originalFileName} 与{" "}
          {task.materials.find((item) => item.id === pair.right)?.originalFileName}：
          {pair.exact
            ? "文件内容完全相同"
            : `解析文本相似度约${Math.round(pair.similarity * 100)}%，请核对是否为重复版本`}
          。不会自动替用户移除文件。
        </p>
      ))}
      <details className="rounded border p-3">
        <summary className="cursor-pointer text-sm">选择提交副本与输出名称</summary>
        <div className="mt-3 space-y-3">
          {task.materials.map((material, index) => {
            const choice = choiceFor(material.id, material.originalFileName, index);
            return (
              <div key={material.id} className="space-y-1 text-xs">
                <label className="block">
                  <input
                    type="checkbox"
                    checked={choice.include}
                    onChange={(event) =>
                      setPackageChoices((previous) => ({
                        ...previous,
                        [material.id]: { ...choice, include: event.target.checked },
                      }))
                    }
                  />{" "}
                  包含 {material.originalFileName} v{material.version}
                </label>
                <label className="block">
                  副本名称：{material.originalFileName}
                  <input
                    aria-label={"副本名称：" + material.originalFileName}
                    maxLength={180}
                    className="mt-1 block min-h-11 w-full rounded border p-2"
                    value={choice.name}
                    onChange={(event) =>
                      setPackageChoices((previous) => ({
                        ...previous,
                        [material.id]: { ...choice, name: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
      </details>
      <button
        disabled={busy || !task.materials.length}
        onClick={() => void download()}
        className="min-h-11 rounded border px-3 text-sm"
      >
        导出当前材料副本提交包
      </button>
      <p className="text-xs">
        包内整理所选原件副本，附文件版本和哈希清单；可调整副本名称，不改动原件，不表示检查通过。
      </p>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
