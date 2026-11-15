"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle, Search, Download, X } from "lucide-react";
import { z } from "zod";
import { examImportOptionSchema, examImportPreviewSchema } from "@/domain/exam-import";
import type { ExamImportOption, ExamImportPreview } from "@/domain/exam-import";
import type { ReactElement } from "react";

export function ExamSourcePicker({
  onSelect,
  onCancel,
  hasInput,
}: {
  onSelect: (preview: ExamImportPreview) => void;
  onCancel: () => void;
  hasInput: boolean;
}): ReactElement {
  const [options, setOptions] = useState<ExamImportOption[]>([]);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState("");
  const [noticeId, setNoticeId] = useState("");
  const [preview, setPreview] = useState<ExamImportPreview | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [listRetry, setListRetry] = useState(0);
  const [previewRetry, setPreviewRetry] = useState(0);
  const loading = listLoading || previewLoading;
  const error = listError || previewError;
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/exam-import", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = z
          .object({ options: z.array(examImportOptionSchema) })
          .parse(await response.json());
        if (!controller.signal.aborted) {
          setOptions(payload.options);
          setListLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setListError("无法读取我的考试，请重试。");
          setListLoading(false);
        }
      });
    return () => controller.abort();
  }, [listRetry]);
  useEffect(() => {
    if (!selection || !noticeId) return;
    const controller = new AbortController();
    void fetch(
      `/api/exam-import?selection=${encodeURIComponent(selection)}&notice=${encodeURIComponent(noticeId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = z.object({ preview: examImportPreviewSchema }).parse(await response.json());
        if (!controller.signal.aborted) {
          setPreview(payload.preview);
          setPreviewLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
          setPreviewError("公告已变化或暂不可用，请重新选择。");
        }
      });
    return () => controller.abort();
  }, [selection, noticeId, previewRetry]);
  const selected = options.find((option) => option.key === selection);
  return (
    <section className="exam-source-picker" aria-label="选择我的考试">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">从我的考试导入</h3>
        <button type="button" className="button-secondary" onClick={onCancel}>
          <X size={16} />
          取消
        </button>
      </div>
      <label className="source-search">
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="搜索已选考试"
          placeholder="搜索考试、地区或考期"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        选择考试
        <select
          aria-label="选择已保存的考试"
          value={selection}
          onChange={(event) => {
            const key = event.target.value;
            const option = options.find((entry) => entry.key === key);
            setSelection(key);
            setNoticeId(option?.candidates.length === 1 ? option.candidates[0]!.id : "");
            setPreview(null);
            setPreviewError("");
            setConfirmed(false);
            setPreviewLoading(!!option?.candidates.length && option.candidates.length === 1);
          }}
        >
          <option value="">请选择</option>
          {["我的考试目标", "已收藏公告"].map((group) => (
            <optgroup key={group} label={group}>
              {options
                .filter(
                  (option) =>
                    option.group === group &&
                    (option.key === selection ||
                      option.label.toLowerCase().includes(query.toLowerCase().trim())),
                )
                .map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {selected && (
        <p className="text-sm" role="status">
          已选：{selected.label}
        </p>
      )}
      {selected && (
        <label className="block text-sm">
          适用公告
          <select
            aria-label="选择适用公告"
            value={noticeId}
            onChange={(event) => {
              setNoticeId(event.target.value);
              setPreview(null);
              setPreviewError("");
              setConfirmed(false);
              setPreviewLoading(!!event.target.value);
            }}
          >
            <option value="">请选择明确场次</option>
            {selected.candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.region} · {item.edition}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && !selected.candidates.length && <p>暂未关联可用公告，可以手动补充要求原文。</p>}
      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <LoaderCircle size={16} className="animate-spin" />
          正在读取…
        </p>
      )}
      {!loading && !options.length && !error && (
        <p>
          还没有保存考试。
          <Link href="/me#goals" className="text-primary underline">
            添加考试目标
          </Link>
          ，或先
          <Link href="/exams" className="text-primary underline">
            浏览考试
          </Link>
          。
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              if (listError) {
                setListError("");
                setListLoading(true);
                setListRetry(listRetry + 1);
              } else {
                setPreviewError("");
                setPreview(null);
                setPreviewLoading(true);
                setConfirmed(false);
                setPreviewRetry(previewRetry + 1);
              }
            }}
          >
            重试
          </button>
        </p>
      )}
      {preview && !previewError && selected?.candidates.some((item) => item.id === preview.id) && (
        <div className="source-preview">
          <p className="font-semibold">{preview.title}</p>
          <p className="text-sm text-muted-foreground">
            {preview.region} · {preview.edition} · 公告版本{preview.version} · {preview.scope}
          </p>
          <a
            href={preview.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary text-sm underline"
          >
            查看公告原文 ↗
          </a>
          <pre>{preview.text}</pre>
          {preview.warning && <p className="text-sm">{preview.warning}</p>}
          {preview.existingTaskId ? (
            <div>
              <p className="mb-3 text-sm">这个考试已有材料任务，可以继续准备。</p>
              <Link className="button-primary" href={`/tasks/${preview.existingTaskId}`}>
                打开原任务 →
              </Link>
            </div>
          ) : (
            <>
              {hasInput && (
                <label className="source-replace">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  用所选考试要求替换当前来源（原输入保留，可切回）
                </label>
              )}
              <button
                type="button"
                className="button-primary"
                disabled={!preview.usable || (hasInput && !confirmed) || loading}
                onClick={() => onSelect(preview)}
              >
                <Download size={16} />
                确认导入
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
