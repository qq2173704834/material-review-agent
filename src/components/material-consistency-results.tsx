"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import type { ReviewTaskDetails } from "@/domain/review";
import type { MaterialConsistencyCheck } from "@/lib/material-consistency";
import { MaterialRevisionEditor } from "@/components/material-revision";
import { EvidencePreview } from "@/components/evidence-preview";

export function MaterialConsistencyResults({
  checks,
  task,
}: {
  checks: MaterialConsistencyCheck[];
  task?: ReviewTaskDetails;
}): ReactElement | null {
  if (!checks.length) return null;
  const issues = checks.filter((check) => check.verdict !== "passed");
  return (
    <section className="my-5 space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">材料信息核对</h3>
      <p className="text-sm text-muted-foreground">
        {checks.length - issues.length}项一致{issues.length ? `，${issues.length}项需要处理` : ""} ·
        材料自查建议
      </p>
      {issues.map((check) => (
        <ConsistencyIssue key={`${check.subject}-${check.field}`} check={check} task={task} />
      ))}
    </section>
  );
}
function ConsistencyIssue({
  check,
  task,
}: {
  check: MaterialConsistencyCheck;
  task?: ReviewTaskDetails;
}): ReactElement {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function confirm(): Promise<void> {
    if (!task) return;
    const candidates = check.candidates.filter((_, i) => selected.includes(i));
    if (
      new Set(candidates.map((candidate) => candidate.materialId)).size < 2 ||
      new Set(candidates.map((candidate) => candidate.materialId)).size !== candidates.length
    ) {
      setMessage("请从至少两份材料中各选一条属于同一对象的信息。");
      return;
    }
    setBusy(true);
    try {
      const existing = task.background.fieldMappings || [];
      const mappings = existing
        .filter(
          (mapping) =>
            !candidates.some(
              (candidate) =>
                candidate.materialId === mapping.materialId &&
                candidate.sourceField === mapping.sourceField,
            ),
        )
        .map(({ confirmedAt, confirmedBy, ...rest }) => {
          void confirmedAt;
          void confirmedBy;
          return rest;
        });
      mappings.push(
        ...candidates.map((candidate) => ({
          materialId: candidate.materialId,
          materialVersion: candidate.materialVersion,
          segmentIndex: candidate.segmentIndex,
          sourceField: candidate.sourceField,
          rawValue: candidate.rawValue,
          canonicalField: check.field,
          subject: `用户确认-${check.field}-${candidates[0]!.materialId}`,
          note: "用户在审查问题中确认所选信息属于同一对象",
        })),
      );
      const response = await fetch(`/api/tasks/${task.id}/field-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected: JSON.stringify(existing), mappings }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setMessage("已确认，请重新检查以更新结果。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="rounded-lg bg-muted/30 p-3">
      <h4 className="font-medium">
        {check.field}
        {check.verdict === "failed" ? "不一致" : "需要确认"}
      </h4>
      <p className="mt-2 text-sm">{check.reason}</p>
      <p className="mt-2 text-sm text-muted-foreground">{check.recommendation}</p>
      {task &&
        check.evidence.map((evidence, index) => (
          <EvidencePreview key={index} taskId={task.id} evidence={[evidence]} />
        ))}
      {task && check.verdict === "needs_confirmation" && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary">
            确认这些信息是否属于同一对象
          </summary>
          {check.candidates.map((candidate, index) => (
            <label key={index} className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(index)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, index]
                      : selected.filter((i) => i !== index),
                  )
                }
              />
              <span>
                {
                  task.materials.find((material) => material.id === candidate.materialId)
                    ?.originalFileName
                }{" "}
                · {candidate.location} · {candidate.sourceField}：{candidate.rawValue}
              </span>
            </label>
          ))}
          <button
            type="button"
            disabled={busy}
            className="mt-3 min-h-11 rounded-lg border px-3 text-sm"
            onClick={() => void confirm()}
          >
            所选信息属于同一对象
          </button>
        </details>
      )}
      {task && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary">
            发现识别错误？核对相关材料
          </summary>
          {task.materials
            .filter((material) =>
              check.candidates.some((candidate) => candidate.materialId === material.id),
            )
            .map((material) => (
              <MaterialRevisionEditor
                key={`${material.id}-${material.version}`}
                taskId={task.id}
                material={material}
                onSaved={() => router.refresh()}
              />
            ))}
        </details>
      )}
      <p role="status" className="mt-2 text-sm">
        {message}
      </p>
    </article>
  );
}
