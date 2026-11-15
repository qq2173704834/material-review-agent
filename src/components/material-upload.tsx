"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialRevisionEditor } from "./material-revision";
import { useUploadQueue } from "@/lib/use-upload-queue";
import { UploadQueue } from "@/components/upload-queue";
import type { ReviewMaterialSummary } from "@/domain/review";
import type { ReactElement } from "react";

const statusLabels = {
  text_extracted: "已读取",
  partial: "部分读取",
  failed: "读取失败",
  ocr_required: "需要文字识别",
} as const;
export function MaterialUpload({
  taskId,
  initialMaterials,
}: {
  taskId: string;
  initialMaterials: ReviewMaterialSummary[];
}): ReactElement {
  const router = useRouter();
  const queue = useUploadQueue(taskId, "materials");
  const [materials, setMaterials] = useState(initialMaterials);
  const [correctionIds, setCorrectionIds] = useState<string[]>([]);
  const [previousInitialMaterials, setPreviousInitialMaterials] = useState(initialMaterials);
  if (initialMaterials !== previousInitialMaterials) {
    setPreviousInitialMaterials(initialMaterials);
    setMaterials(initialMaterials);
  }
  return (
    <section aria-labelledby="materials-heading" className="min-w-0">
      <h3 id="materials-heading" className="text-sm font-semibold">
        上传待审查材料
      </h3>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        支持：PDF、DOCX、TXT、XLSX、CSV、JPG/JPEG、PNG、MD、JSON、YAML/YML、ZIP、MP4、WEBM、MOV
      </p>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          queue.enqueue(Array.from(event.dataTransfer.files));
        }}
        className="mt-4 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4"
      >
        <label htmlFor="material-files" className="block text-sm font-medium">
          选择或拖入文件，自动上传并读取
        </label>
        <input
          id="material-files"
          aria-label="选择审查材料"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.xlsx,.csv,.jpg,.jpeg,.png,.zip,.md,.json,.yaml,.yml,.mp4,.webm,.mov"
          onChange={(event) => {
            queue.enqueue(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
          className="mt-3 min-h-11 w-full min-w-0 text-xs file:mr-2 file:min-h-11 file:rounded-lg file:border file:bg-card file:px-3"
        />
      </div>
      <UploadQueue {...queue} />
      {materials.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">尚未上传材料。</p>
      ) : (
        <ul className="mt-5 divide-y divide-border border-y border-border">
          {materials.map((material) => (
            <li key={material.id} id={`material-${material.id}`} className="scroll-mt-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{material.originalFileName}</p>
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {statusLabels[material.parseStatus]}
                </span>
              </div>
              <a
                className="mt-2 inline-block text-xs text-primary underline"
                href={`/api/tasks/${taskId}/materials/${material.id}/versions/${material.version}?file=1`}
                target="_blank"
                rel="noreferrer"
              >
                查看文件
              </a>
              {material.parseStatus !== "text_extracted" && (
                <p className="mt-2 text-xs text-amber-800">
                  {material.parseStatus === "partial"
                    ? "部分内容未能读取，请核对后补充。"
                    : "暂时无法读取，请重新上传或核对文字。"}
                </p>
              )}
              {material.parseStatus === "text_extracted" &&
                material.classification &&
                !correctionIds.includes(material.id) && (
                  <button
                    type="button"
                    className="ml-4 min-h-11 text-xs text-primary underline"
                    onClick={() => setCorrectionIds([...correctionIds, material.id])}
                  >
                    调整材料
                  </button>
                )}
              {(material.parseStatus !== "text_extracted" ||
                !material.classification ||
                correctionIds.includes(material.id)) && (
                <MaterialRevisionEditor
                  key={`${material.id}-${material.version}`}
                  taskId={taskId}
                  material={material}
                  onSaved={(saved) => {
                    setMaterials((current) =>
                      current.map((item) => (item.id === saved.id ? saved : item)),
                    );
                    router.refresh();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
