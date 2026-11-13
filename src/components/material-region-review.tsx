"use client";
/* eslint-disable @next/next/no-img-element -- authenticated private page images cannot use the public image optimizer. */
import { useState } from "react";
import { useTaskActivity } from "@/components/task-workspace";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { ReactElement } from "react";
import type { MaterialRegion, ReviewMaterialSummary } from "@/domain/review";
export function MaterialRegionReview({
  taskId,
  material,
  segmentIndex,
  onSaved,
}: {
  taskId: string;
  material: ReviewMaterialSummary;
  segmentIndex: number;
  onSaved: (material: ReviewMaterialSummary) => void;
}): ReactElement | null {
  const segment = material.segments.find((item) => item.segmentIndex === segmentIndex),
    region = segment?.region;
  const [role, setRole] = useState<MaterialRegion["role"]>(region?.role ?? "body");
  const [recognition, setRecognition] = useState<MaterialRegion["recognition"]>(
    region?.recognition ?? "unknown",
  );
  const [order, setOrder] = useState(region?.readingOrder ?? 0);
  const [tableId, setTableId] = useState(region?.cell?.tableId ?? "");
  const [row, setRow] = useState(region?.cell?.row ?? 1),
    [column, setColumn] = useState(region?.cell?.column ?? 1);
  const [rowSpan, setRowSpan] = useState(region?.cell?.rowSpan ?? 1),
    [columnSpan, setColumnSpan] = useState(region?.cell?.columnSpan ?? 1);
  const [continues, setContinues] = useState(region?.cell?.continuesFromPage ?? 0);
  const [note, setNote] = useState("");
  const [rotate, setRotate] = useState(0),
    [normalize, setNormalize] = useState(true),
    [sharpen, setSharpen] = useState(false);
  const [perspective, setPerspective] = useState(false);
  const [corners, setCorners] = useState([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const clear = useUnsavedChanges(Boolean(note));
  useTaskActivity(
    `region-${material.id}`,
    busy ? "正在处理图像区域" : note ? "请先保存或取消区域核对" : null,
  );
  if (!["pdf", "png", "jpg"].includes(material.extension)) return null;
  const page = region?.pageNumber ?? 1;
  const imageUrl = `/api/tasks/${taskId}/materials/${material.id}/image?version=${material.version}&page=${page}`;
  const previewUrl = `${imageUrl}&preview=1&rotate=${rotate}&normalize=${normalize ? 1 : 0}&sharpen=${sharpen ? 1 : 0}${perspective ? `&corners=${encodeURIComponent(JSON.stringify(corners))}` : ""}`;
  const inputClass = "block w-full rounded border border-border bg-background p-2 text-xs";
  async function save(action: "region" | "enhance"): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/materials/${material.id}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          version: material.version,
          segmentIndex,
          note,
          role,
          recognition,
          readingOrder: order,
          cell:
            role === "table"
              ? {
                  tableId,
                  row,
                  column,
                  rowSpan,
                  columnSpan,
                  ...(continues ? { continuesFromPage: continues } : {}),
                }
              : undefined,
          processing: {
            rotateDegrees: rotate,
            normalize,
            sharpen,
            ...(perspective ? { corners } : {}),
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "保存失败。");
        return;
      }
      clear();
      setNote("");
      setPreview("");
      onSaved(result.material);
    } catch {
      setMessage("无法连接服务，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="space-y-3 border border-border p-3">
      <summary className="cursor-pointer text-sm">图像区域、阅读顺序与增强核对</summary>
      <p className="text-xs leading-5">
        坐标对应本版本用于识别的页图。候选顺序和表格关系需对照原图；姓名、证号、日期、金额等关键文字应逐区域核对。手写仍使用通用OCR，不能保证识别质量；签章不作真伪判断。
      </p>
      <div className="relative my-3 max-w-2xl">
        <img
          src={imageUrl}
          alt={`第${page}页识别图像，当前选中区域用框标记`}
          className="block w-full"
        />
        {region ? (
          <div
            aria-label="所选文字区域"
            className="pointer-events-none absolute border-2 border-red-600 bg-red-500/10"
            style={{
              left: `${region.box.x * 100}%`,
              top: `${region.box.y * 100}%`,
              width: `${region.box.width * 100}%`,
              height: `${region.box.height * 100}%`,
            }}
          />
        ) : null}
      </div>
      {region ? (
        <>
          <p className="text-xs">
            状态：{region.status === "confirmed" ? "人工已确认" : "待核对候选"} · {region.note}{" "}
            {region.reviewedBy ? `· ${region.reviewedBy} · ${region.reviewedAt}` : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              区域类型
              <select
                className={inputClass}
                value={role}
                onChange={(event) => setRole(event.target.value as MaterialRegion["role"])}
              >
                <option value="body">正文</option>
                <option value="header">页眉</option>
                <option value="footer">页脚</option>
                <option value="sidebar">侧栏</option>
                <option value="table">表格单元格</option>
              </select>
            </label>
            <label className="text-xs">
              识别内容类别
              <select
                className={inputClass}
                value={recognition}
                onChange={(event) =>
                  setRecognition(event.target.value as MaterialRegion["recognition"])
                }
              >
                <option value="unknown">尚未确定</option>
                <option value="printed">印刷体（通用OCR）</option>
                <option value="handwritten">手写（通用OCR候选，已人工核对）</option>
              </select>
            </label>
            <label className="text-xs">
              阅读顺序
              <input
                type="number"
                min={0}
                max={10000}
                className={inputClass}
                value={order}
                onChange={(event) => setOrder(Number(event.target.value))}
              />
            </label>
            {role === "table" ? (
              <>
                <label className="text-xs">
                  表格标识
                  <input
                    className={inputClass}
                    maxLength={80}
                    value={tableId}
                    onChange={(event) => setTableId(event.target.value)}
                  />
                </label>
                {[
                  { label: "行号（跨页连续编号）", value: row, set: setRow },
                  { label: "列号", value: column, set: setColumn },
                  { label: "合并行数", value: rowSpan, set: setRowSpan },
                  { label: "合并列数", value: columnSpan, set: setColumnSpan },
                  { label: "续表来源页（0为无）", value: continues, set: setContinues },
                ].map((item) => (
                  <label key={item.label} className="text-xs">
                    {item.label}
                    <input
                      type="number"
                      min={item.label.startsWith("续表") ? 0 : 1}
                      max={10000}
                      className={inputClass}
                      value={item.value}
                      onChange={(event) => item.set(Number(event.target.value))}
                    />
                  </label>
                ))}
              </>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-xs">此历史片段没有图像坐标；重新识别后才能按区域核对。</p>
      )}
      <label className="block text-xs">
        区域/增强核对依据
        <input
          className={inputClass}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {region ? (
        <button
          type="button"
          disabled={busy || !note.trim() || recognition === "unknown"}
          className="my-2 min-h-11 rounded border px-3 text-xs"
          onClick={() => void save("region")}
        >
          确认所选区域文字与结构
        </button>
      ) : null}
      {["png", "jpg"].includes(material.extension) ? (
        <div className="space-y-3 border-t pt-3">
          <p className="text-xs">
            原图与候选对照；倾斜、阴影和低对比度可尝试增强。可尝试手动四角透视校正；严重遮挡或失焦请重传清晰原件。
          </p>
          <img src={`${imageUrl}&original=1`} alt="保留的原始图像" className="max-w-sm" />
          <label className="block text-xs">
            旋转角度（-15至15度）
            <input
              className={inputClass}
              type="number"
              min={-15}
              max={15}
              step={0.5}
              value={rotate}
              onChange={(event) => setRotate(Number(event.target.value))}
            />
          </label>
          <label className="block text-xs">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(event) => setNormalize(event.target.checked)}
            />{" "}
            对比度与局部阴影增强
          </label>
          <label className="block text-xs">
            <input
              type="checkbox"
              checked={sharpen}
              onChange={(event) => setSharpen(event.target.checked)}
            />{" "}
            轻度锐化
          </label>
          <details className="text-xs">
            <summary>透视校正（手动指定原图四角）</summary>
            <label className="block py-2">
              <input
                type="checkbox"
                checked={perspective}
                onChange={(event) => setPerspective(event.target.checked)}
              />{" "}
              启用透视候选
            </label>
            <p>
              按左上、右上、右下、左下输入原图归一化坐标0—1；四边形必须凸且不交叉。原件保留，增强后所有区域重新核对。
            </p>
            <div className="grid grid-cols-2 gap-2">
              {corners.map((point, index) => (
                <div key={index}>
                  {["左上", "右上", "右下", "左下"][index]}
                  {(["x", "y"] as const).map((axis) => (
                    <label key={axis} className="block">
                      {axis}
                      <input
                        className={inputClass}
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={point[axis]}
                        onChange={(event) =>
                          setCorners((previous) =>
                            previous.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, [axis]: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </details>
          <button
            type="button"
            className="min-h-11 rounded border px-3 text-xs"
            onClick={() => setPreview(previewUrl)}
          >
            预览增强候选
          </button>
          {preview ? (
            <>
              <img src={preview} alt="尚未采用的增强候选" className="max-w-sm" />
              <button
                type="button"
                disabled={busy || !note.trim() || preview !== previewUrl}
                className="min-h-11 rounded border px-3 text-xs"
                onClick={() => void save("enhance")}
              >
                采用当前候选并重新识别
              </button>
              <button
                type="button"
                className="min-h-11 px-3 text-xs underline"
                onClick={() => setPreview("")}
              >
                放弃候选
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-xs">
          {message}
        </p>
      ) : null}
    </details>
  );
}
