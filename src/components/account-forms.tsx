"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import { safeNext } from "@/lib/safe-next";
const field = "mt-1 block w-full rounded-lg border bg-background px-3 py-2";
function subscribeToHydration(): () => void {
  return () => {};
}
export function AccountForm({
  mode,
}: {
  mode: "login" | "register" | "recover" | "account";
}): ReactElement {
  const router = useRouter();
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);
  const [deletionSummary, setDeletionSummary] = useState<{
    tasks: Array<{ id: string; name: string; materialCount: number }>;
    scope: string;
  } | null>(null);
  const [action, setAction] = useState("profile");
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (values.confirmPassword !== undefined && values.password !== values.confirmPassword) {
      setMessage("两次密码输入不一致。");
      return;
    }
    delete values.confirmPassword;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/auth/${mode === "account" ? action : mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "操作失败，请重试。");
        return;
      }
      form
        .querySelectorAll<HTMLInputElement>('input[type="password"], input[data-secret]')
        .forEach((input) => {
          input.value = "";
        });
      if (payload.recoveryCodes) {
        setCodes(payload.recoveryCodes);
        setMessage(payload.message);
        return;
      }
      if (mode === "login") {
        // Authentication changes must discard prefetched anonymous redirects and private route caches.
        window.location.assign(safeNext(new URLSearchParams(window.location.search).get("next")));
        return;
      }
      if (["logout", "logout-all", "delete"].includes(action)) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear all private router state after logout.
        window.location.assign("/login");
        return;
      }
      setMessage("已保存。");
      if (mode === "account" && action === "profile") router.refresh();
    } catch {
      setMessage("暂时无法连接，请重试。已填写的非敏感信息保留。");
    } finally {
      setBusy(false);
    }
  }
  if (codes.length)
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold">保存你的账号恢复码</h1>
        <p role="status">{message}</p>
        <p>
          恢复码仅在本次显示。请保存到安全位置；忘记密码时凭用户名和任意一条恢复码重设。重设密码会使全部旧恢复码失效。丢失密码和全部恢复码将无法自助找回。
        </p>
        <pre className="overflow-auto rounded-lg border bg-muted p-4">{codes.join("\n")}</pre>
        <button
          className={field}
          onClick={() => {
            const blob = new Blob([codes.join("\n")], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "exam-account-recovery-codes.txt";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          }}
        >
          下载恢复码
        </button>
        <Link className="block text-primary underline" href="/login">
          我已安全保存，前往登录
        </Link>
      </section>
    );
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">
        {{ login: "登录", register: "注册账号", recover: "重设密码", account: "账号设置" }[mode]}
      </h1>
      {mode === "account" && (
        <label className="block">
          操作
          <select
            className={field}
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              if (event.target.value === "delete")
                void fetch("/api/auth/delete")
                  .then(async (response) => {
                    const payload = await response.json();
                    if (response.ok) setDeletionSummary(payload.deletionSummary);
                    else setMessage(payload.error);
                  })
                  .catch(() => setMessage("无法读取注销清单，请重试。"));
              setMessage("");
            }}
          >
            <option value="profile">修改昵称</option>
            <option value="password">修改密码</option>
            <option value="logout">退出当前登录</option>
            <option value="logout-all">退出全部登录</option>
            <option value="delete">注销账号及所属任务</option>
          </select>
        </label>
      )}
      <form
        key={action}
        method="post"
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
      >
        {mode !== "account" && (
          <label className="block">
            用户名
            <input
              name="username"
              className={field}
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z][a-zA-Z0-9_]{2,31}"
              aria-describedby="username-help"
            />
            <span id="username-help" className="text-xs text-muted-foreground">
              3—32位，以英文字母开头，字母、数字或下划线；不区分大小写。
            </span>
          </label>
        )}
        {(mode === "register" || (mode === "account" && action === "profile")) && (
          <label className="block">
            昵称
            <input name="nickname" className={field} maxLength={40} required={mode === "account"} />
          </label>
        )}
        {mode === "recover" && (
          <label className="block">
            恢复码
            <input
              name="recoveryCode"
              className={field}
              required
              data-secret
              autoComplete="off"
              maxLength={32}
            />
          </label>
        )}
        {mode === "account" && action === "password" && (
          <label className="block">
            当前密码
            <input
              name="currentPassword"
              className={field}
              required
              type={visible ? "text" : "password"}
              data-secret
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
        )}
        {(mode !== "account" || ["password", "delete"].includes(action)) && (
          <>
            <label className="block">
              {mode === "recover" || action === "password" ? "新密码" : "密码"}
              <input
                name="password"
                className={field}
                required
                type={visible ? "text" : "password"}
                data-secret
                autoComplete={
                  mode === "login" || action === "delete" ? "current-password" : "new-password"
                }
                minLength={mode === "login" || action === "delete" ? 1 : 12}
                maxLength={128}
              />
            </label>
            {mode !== "login" && action !== "delete" && (
              <>
                <p className="text-xs">至少12位，建议使用独有的长密码。</p>
                <label className="block">
                  确认新密码
                  <input
                    name="confirmPassword"
                    className={field}
                    type={visible ? "text" : "password"}
                    data-secret
                    required
                    autoComplete="new-password"
                    maxLength={128}
                  />
                </label>
              </>
            )}
            <label className="block text-sm">
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => setVisible(event.target.checked)}
              />{" "}
              显示密码
            </label>
          </>
        )}
        {mode === "account" && action === "delete" && (
          <>
            {deletionSummary && (
              <div className="rounded border p-3">
                <p>将删除{deletionSummary.tasks.length}个所属任务：</p>
                <ul>
                  {deletionSummary.tasks.map((task) => (
                    <li key={task.id}>
                      {task.name} · {task.materialCount}份材料
                    </li>
                  ))}
                </ul>
                <p>{deletionSummary.scope}</p>
              </div>
            )}
            <p>
              将删除账号、恢复码、登录会话和自己拥有的任务及材料；不会删除他人拥有的共享任务。操作不可恢复，请先导出需要的报告。
            </p>
            <label className="block">
              输入“注销并删除我的任务”确认
              <input className={field} name="confirmation" required />
            </label>
          </>
        )}
        <p role="status" aria-live="polite">
          {message}
        </p>
        <button
          disabled={busy || !isHydrated}
          className="w-full rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50"
        >
          {busy
            ? "正在处理…"
            : mode === "account"
              ? "确认操作"
              : { login: "登录", register: "创建账号", recover: "重设并生成新恢复码" }[mode]}
        </button>
      </form>
      <nav aria-label="账号导航" className="flex flex-wrap gap-4 text-sm text-primary underline">
        <Link href="/login">登录</Link>
        <Link href="/register">注册</Link>
        <Link href="/recover">忘记密码</Link>
        <Link href="/exams">考试中心</Link>
      </nav>
    </section>
  );
}
