"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fieldCandidates } from "@/lib/field-alignment";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { useTaskActivity } from "@/components/task-workspace";
import type { ReviewTaskDetails } from "@/domain/review";
import type { ReactElement } from "react";

export function FieldMappings({ task }: { task: ReviewTaskDetails }): ReactElement {
  const router = useRouter();
  const candidates = fieldCandidates(task.materials);
  const [selected, setSelected] = useState("");
  const [subject, setSubject] = useState("");
  const [field, setField] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const clear = useUnsavedChanges(Boolean(subject || field || note));
  useTaskActivity(
    "field-mapping",
    busy ? "正在保存字段对齐" : subject || field || note ? "请先保存或取消字段映射" : null,
  );
  const mappings = task.background.fieldMappings ?? [];
  async function save(remove?: number): Promise<void> {
    const candidate = candidates[Number(selected)];
    if (
      remove === undefined &&
      (!selected || !candidate || !subject.trim() || !field.trim() || !note.trim())
    ) {
      setError("请选择原文字段，并填写具体主体、标准字段和确认依据。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const records = mappings
        .filter((_, index) => index !== remove)
        .map(({ confirmedBy, confirmedAt, ...mapping }) => {
          void confirmedBy;
          void confirmedAt;
          return mapping;
        });
      if (remove === undefined && candidate)
        records.push({
          subject,
          canonicalField: field,
          materialId: candidate.materialId,
          materialVersion: candidate.materialVersion,
          segmentIndex: candidate.segmentIndex,
          sourceField: candidate.sourceField,
          rawValue: candidate.rawValue,
          note,
        });
      const response = await fetch(`/api/tasks/${task.id}/field-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected: JSON.stringify(mappings), mappings: records }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "保存失败。");
        return;
      }
      clear();
      setSubject("");
      setField("");
      setNote("");
      setSelected("");
      router.refresh();
    } catch {
      setError("无法连接服务，请重试。");
    } finally {
      setBusy(false);
    }
  }
  const inputClass = "block w-full rounded border border-border bg-background p-2 text-sm";
  return (
    <details className="my-6 border border-border p-4">
      <summary className="cursor-pointer font-medium">跨材料字段对齐</summary>
      <p className="my-3 text-sm text-muted-foreground">
        候选来自原文字段（最多展示5000项）。请用独立主体标识区分申请人、成员、导师或项目；标准字段须对应规则中的字段名。确认后才参与比较，材料变化后需重新确认。
      </p>
      <div className="space-y-3">
        <label className="block text-sm">
          原文字段
          <select
            className={inputClass}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">选择候选，不自动合并别名</option>
            {candidates.map((item, index) => (
              <option key={index} value={index}>
                {
                  task.materials.find((material) => material.id === item.materialId)
                    ?.originalFileName
                }{" "}
                v{item.materialVersion} · {item.location} · {item.sourceField}：{item.rawValue}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          具体主体
          <input
            className={inputClass}
            maxLength={80}
            placeholder="如：申请人A（不能只按姓名合并）"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          标准字段
          <input
            className={inputClass}
            maxLength={40}
            placeholder="如：负责人、项目名称"
            value={field}
            onChange={(event) => setField(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          确认依据
          <input
            className={inputClass}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={() => void save()}
        >
          确认字段映射
        </button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <ul className="space-y-3">
          {mappings.map((mapping, index) => (
            <li key={index} className="border-t border-border pt-2 text-sm">
              {mapping.subject} · {mapping.canonicalField} ← {mapping.sourceField}：
              {mapping.rawValue}（v{mapping.materialVersion}）
              <p>
                依据：{mapping.note} · 确认人：{mapping.confirmedBy} · {mapping.confirmedAt}
              </p>
              <button
                type="button"
                disabled={busy}
                className="underline"
                onClick={() => void save(index)}
              >
                移除此映射
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
