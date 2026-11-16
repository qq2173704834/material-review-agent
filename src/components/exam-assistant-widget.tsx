"use client";
import { ContentFeedback } from "@/components/content-feedback";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CATEGORY_LABELS } from "@/domain/exam-catalog";
import type { ExamCategoryId } from "@/domain/exam-catalog";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import type { AssistantAnswer } from "@/domain/assistant";
interface State {
  mode: string;
  policy: { enabled: boolean; hourlyLimit: number };
  usage: {
    questions: number;
    failed: number;
    modelRequests: number;
    inputTokens: number;
    outputTokens: number;
    unknownTokenCalls: number;
  };
  conversations: Array<{ id: string; title: string }>;
  goals: Array<{ id: string; category: string; edition: string }>;
  messages: Array<{ role: string; payload: { question?: string } & Partial<AssistantAnswer> }>;
}
export function ExamAssistantWidget(): ReactElement | null {
  const pathname = usePathname();
  if (/^\/(login|register|recover|welcome)(?:\/|$)/.test(pathname)) return null;
  return <AssistantPanel />;
}
function AssistantPanel(): ReactElement {
  const [open, setOpen] = useState(false),
    [state, setState] = useState<State | null>(null),
    [conversation, setConversation] = useState(""),
    [question, setQuestion] = useState(""),
    [goal, setGoal] = useState(""),
    [context, setContext] = useState(false),
    [learning, setLearning] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyAbort = useRef<AbortController | null>(null);
  const historySequence = useRef(0);
  const sendSequence = useRef(0);
  const pending = useRef(false);
  const editRevision = useRef(0);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const abort = useRef<AbortController | null>(null),
    trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async (id = ""): Promise<void> => {
    historyAbort.current?.abort();
    const controller = new AbortController();
    historyAbort.current = controller;
    const sequence = ++historySequence.current;
    try {
      const response = await fetch(
        `/api/assistant${id ? `?conversation=${encodeURIComponent(id)}` : ""}`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("助手暂不可用，请稍后重试。");
      const latest: State = await response.json();
      if (!controller.signal.aborted && sequence === historySequence.current) setState(latest);
    } catch {
      if (!controller.signal.aborted && sequence === historySequence.current)
        setError("无法读取助手，请重试。");
    } finally {
      if (!controller.signal.aborted && sequence === historySequence.current)
        setHistoryLoading(false);
    }
  }, []);
  const close = useCallback((): void => {
    sendSequence.current++;
    abort.current?.abort();
    historyAbort.current?.abort();
    historySequence.current++;
    setHistoryLoading(false);
    setOpen(false);
    trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, close]);
  useEffect(
    () => () => {
      abort.current?.abort();
      historyAbort.current?.abort();
    },
    [],
  );
  async function send(): Promise<void> {
    if (pending.current || historyLoading || !question.trim()) return;
    pending.current = true;
    const sequence = ++sendSequence.current;
    const submitted = {
      question,
      goalId: goal || undefined,
      useContext: context,
      learning,
      conversationId: conversation || undefined,
    };
    const revision = editRevision.current;
    const fingerprint = JSON.stringify(submitted);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({ requestId: attempt.current.requestId, ...submitted }),
      });
      const answer = (await response.json()) as AssistantAnswer & { error?: string };
      if (!response.ok) throw new Error(answer.error ?? "回答失败");
      if (sequence !== sendSequence.current) return;
      if (answer.conversationId) {
        setHistoryLoading(true);
        setConversation(answer.conversationId);
        await load(answer.conversationId);
      } else
        setState((previous) =>
          previous
            ? {
                ...previous,
                messages: [
                  ...previous.messages,
                  { role: "user", payload: { question } },
                  { role: "assistant", payload: answer },
                ],
              }
            : previous,
        );
      attempt.current = null;
      if (sequence === sendSequence.current && editRevision.current === revision) setQuestion("");
    } catch (cause) {
      if (sequence !== sendSequence.current) return;
      setError(
        cause instanceof Error && cause.name === "AbortError"
          ? "已停止等待回复。"
          : cause instanceof Error
            ? cause.message
            : "请求失败，可重试。",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      abort.current = null;
      void fetch("/api/assistant")
        .then(async (response) => {
          if (!response.ok) return;
          const latest = await response.json();
          setState((previous) => (previous ? { ...previous, usage: latest.usage } : previous));
        })
        .catch(() => undefined);
    }
  }
  return (
    <div className="assistant-widget fixed right-3 bottom-3 z-50 sm:right-5 sm:bottom-5">
      <button
        ref={trigger}
        aria-label="打开考试学习AI助手"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setState(null);
            setHistoryLoading(true);
            setError("");
            void load(conversation);
          }
          if (open) close();
          else setOpen(true);
        }}
        className="assistant-trigger flex items-center gap-2 rounded-full border bg-card p-3 shadow-lg"
      >
        <svg aria-hidden="true" width="42" height="42" viewBox="0 0 48 48">
          <path
            d="M9 19Q4 5 18 12Q27 1 32 13Q45 8 41 25Q46 42 25 44Q5 43 9 19Z"
            fill="#a7d8f0"
            stroke="#235578"
            strokeWidth="2"
          />
          <circle cx="18" cy="25" r="3" />
          <circle cx="32" cy="25" r="3" />
          <path d="M20 33Q25 38 30 33" fill="none" stroke="#235578" strokeWidth="2" />
        </svg>
        <span className="hidden sm:inline">考试学习助手</span>
      </button>
      {open && (
        <section
          role="dialog"
          aria-label="考试学习AI助手"
          className="assistant-panel absolute right-0 bottom-20 flex h-[min(82dvh,800px)] w-[min(30rem,calc(100vw-3rem))] flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b pb-3">
            <h2 className="text-base font-semibold">考试学习AI助手</h2>
            <button
              type="button"
              className="rounded-lg px-3 text-sm text-muted-foreground"
              onClick={close}
            >
              关闭
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="assistant-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {historyLoading && <p role="status">正在读取会话…</p>}
              <p className="text-xs leading-6 text-muted-foreground">
                {state?.mode === "mock"
                  ? "模拟模式，未调用真实模型"
                  : "问考试、找资料，也可以一起制定学习计划。"}
              </p>
              {state && !state.policy.enabled && (
                <p role="status" className="text-xs">
                  助手暂不可用，你仍可浏览考试与资料。
                </p>
              )}
              <details className="text-sm">
                <summary>历史会话</summary>
                <label>
                  私有会话
                  <select
                    disabled={busy}
                    value={conversation}
                    onChange={(event) => {
                      setHistoryLoading(true);
                      setConversation(event.target.value);
                      setError("");
                      void load(event.target.value);
                    }}
                    className="w-full rounded border p-2"
                  >
                    <option value="">新会话</option>
                    {state?.conversations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-4 text-sm">
                  <button
                    disabled={busy}
                    className="underline"
                    onClick={() => {
                      setHistoryLoading(true);
                      setConversation("");
                      void load();
                      setState((previous) => (previous ? { ...previous, messages: [] } : previous));
                    }}
                  >
                    新建会话
                  </button>
                  <button
                    disabled={busy || historyLoading || !conversation}
                    className="underline"
                    onClick={async () => {
                      if (pending.current) return;
                      pending.current = true;
                      const sequence = ++sendSequence.current;
                      setBusy(true);
                      setError("");
                      try {
                        const response = await fetch("/api/assistant", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: conversation }),
                        });
                        if (!response.ok) throw new Error("删除失败");
                        if (sequence !== sendSequence.current) return;
                        setHistoryLoading(true);
                        setConversation("");
                        await load();
                      } catch {
                        if (sequence === sendSequence.current) setError("删除失败，请重试。");
                      } finally {
                        pending.current = false;
                        setBusy(false);
                      }
                    }}
                  >
                    删除当前历史
                  </button>
                </div>
              </details>
              <div className="space-y-4" aria-live="polite">
                {state?.messages.map((message, index) => (
                  <article key={index} className="rounded border p-3 text-sm">
                    <strong>{message.role === "user" ? "你" : "助手"}</strong>
                    <p className="whitespace-pre-wrap">
                      {message.payload.question ?? message.payload.answer}
                    </p>
                    {message.payload.warning && (
                      <p className="mt-2 text-xs">{message.payload.warning}</p>
                    )}
                    {(message.payload.actionLink?.href.startsWith("/me/schedule?") ||
                      message.payload.actionLink?.href.startsWith("/campus?")) && (
                      <Link
                        className="button-secondary mt-3"
                        href={message.payload.actionLink.href}
                      >
                        {message.payload.actionLink.label}
                      </Link>
                    )}
                    {message.payload.answer && (
                      <ContentFeedback
                        answer={message.payload.answer}
                        citations={message.payload.citations}
                      />
                    )}
                    {message.payload.citations?.map((citation) => (
                      <details key={citation.id}>
                        <summary>
                          {citation.title}
                          {citation.sourceType === "非官方参考" && " · 第三方参考"}
                        </summary>
                        <blockquote className="whitespace-pre-wrap">{citation.quote}</blockquote>
                        <p>
                          {citation.scope} · 更新：{citation.checkedAt}
                        </p>
                        <a className="underline" href={citation.url}>
                          核对来源详情
                        </a>
                      </details>
                    ))}
                  </article>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" aria-label="示例问题">
                {[
                  "本考期的报名条件和截止时间是什么？",
                  "请帮我安排一周的基础复习计划。",
                  "我需要准备哪些报名材料？",
                ].map((example, index) => (
                  <button
                    key={example}
                    type="button"
                    disabled={busy}
                    className="assistant-suggestion rounded-lg border px-3 py-2 text-left text-xs"
                    onClick={() => {
                      editRevision.current++;
                      setQuestion(example);
                      setLearning(index === 1);
                      input.current?.focus();
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
              <details>
                <summary>回答设置</summary>
                <div className="mt-3 space-y-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      disabled={busy}
                      type="checkbox"
                      checked={learning}
                      onChange={(event) => setLearning(event.target.checked)}
                    />{" "}
                    学习讲解/练习建议（AI生成）
                  </label>
                  <label className="block text-sm">
                    考试目标
                    <select
                      value={goal}
                      disabled={busy}
                      onChange={(event) => setGoal(event.target.value)}
                      className="mt-2 w-full rounded-lg border p-2"
                    >
                      <option value="">不选择</option>
                      {state?.goals.map((item) => (
                        <option value={item.id} key={item.id}>
                          {CATEGORY_LABELS[item.category as ExamCategoryId] ?? item.category} ·{" "}
                          {item.edition}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={context}
                      onChange={(event) => setContext(event.target.checked)}
                    />{" "}
                    本次使用所选目标的考试、地区、考期
                  </label>
                </div>
              </details>
            </div>
            <form
              className="shrink-0 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="block shrink-0 text-sm">
                你的问题
                <textarea
                  ref={input}
                  maxLength={3000}
                  required
                  value={question}
                  onChange={(event) => {
                    editRevision.current++;
                    setQuestion(event.target.value);
                  }}
                  className="mt-2 h-20 min-h-16 w-full resize-none rounded-xl border p-3 text-sm"
                  placeholder="例如：本考期的报名条件是什么？"
                />
              </label>
              <div className="flex gap-4">
                <button
                  disabled={
                    busy || historyLoading || !state || !state.policy.enabled || !question.trim()
                  }
                  className="button-primary"
                >
                  {busy ? "正在回答…" : "发送"}
                </button>
                {busy && (
                  <button type="button" onClick={() => abort.current?.abort()}>
                    取消
                  </button>
                )}
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                回答由AI生成，你的问题及相关参考信息会用于生成回答。
                <Link className="ml-1 text-primary underline" href="/learn#assistant-privacy">
                  隐私设置
                </Link>
              </p>
              <p role="status" className="text-sm text-red-700">
                {error}
                {error && !busy && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => {
                      setHistoryLoading(true);
                      setError("");
                      void load(conversation);
                    }}
                  >
                    重试
                  </button>
                )}
              </p>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
