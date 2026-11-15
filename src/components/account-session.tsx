"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { LoaderCircle, LogOut, UserRound } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

type Identity = { id: string; username: string; role: string };
const SessionContext = createContext<{
  account: Identity | null;
  loading: boolean;
  error: string;
  refresh: () => void;
}>({ account: null, loading: true, error: "", refresh: () => {} });
const logoutSignal = "exam-session-ended";
function loginPage(): void {
  window.location.replace(new URL("/login", window.location.origin).href);
}
export function AccountSessionProvider({ children }: { children: ReactNode }): ReactElement {
  const pathname = usePathname();
  const [account, setAccount] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const previous = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback((): void => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    void fetch("/api/auth/me", { cache: "no-store", signal: active.signal })
      .then(async (response) => {
        if (active.signal.aborted) return;
        if (response.status === 401) {
          setAccount(null);
          setError("");
          if (previous.current) loginPage();
          return;
        }
        if (!response.ok) throw new Error();
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("account" in payload)) throw new Error();
        const value = payload.account;
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          !("username" in value) ||
          !("role" in value) ||
          typeof value.id !== "string" ||
          typeof value.username !== "string" ||
          typeof value.role !== "string"
        )
          throw new Error();
        if (active.signal.aborted) return;
        if (previous.current && previous.current !== value.id) {
          window.location.reload();
          return;
        }
        previous.current = value.id;
        setAccount({ id: value.id, username: value.username, role: value.role });
        setError("");
      })
      .catch(() => {
        if (!active.signal.aborted) {
          setAccount(null);
          setError("账号信息暂不可用");
        }
      })
      .finally(() => {
        if (!active.signal.aborted) setLoading(false);
      });
  }, []);
  useEffect(() => {
    refresh();
    const visible = (): void => {
      if (document.visibilityState === "visible") refresh();
    };
    const ended = (event: StorageEvent): void => {
      if (event.key === logoutSignal) loginPage();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", ended);
    return () => {
      controller.current?.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", ended);
    };
  }, [pathname, refresh]);
  return (
    <SessionContext.Provider value={{ account, loading, error, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}
export function AccountNavigation(): ReactElement {
  const { account } = useContext(SessionContext);
  return (
    <>
      {account?.role === "admin" && (
        <>
          <Link href="/admin/system" className="account-admin-link">
            服务维护
          </Link>
          <Link href="/admin/exams" className="account-admin-link">
            内容管理
          </Link>
          <Link href="/admin/campus" className="account-admin-link">
            校园来源
          </Link>
          <Link href="/admin/learning" className="account-admin-link">
            学习与知识管理
          </Link>
        </>
      )}
    </>
  );
}
export function AccountMenu(): ReactElement {
  const { account, loading, error, refresh } = useContext(SessionContext);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const pending = useRef(false);
  async function logout(): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      try {
        for (const key of Object.keys(sessionStorage))
          if (key.startsWith("browse:")) sessionStorage.removeItem(key);
        localStorage.setItem(logoutSignal, String(Date.now()));
      } catch {
        /* Storage restrictions must not prevent session revocation. */
      }
      loginPage();
    } catch {
      setFailure("退出失败，请重试。");
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="account-menu" aria-label="当前账号">
      {loading ? (
        <span className="account-loading" role="status">
          正在读取账号…
        </span>
      ) : account ? (
        <>
          <Link
            href="/account"
            className="account-identity"
            aria-label={`账号设置：${account.username}`}
            title={account.username}
          >
            <span className="account-avatar">
              <UserRound size={17} aria-hidden="true" />
            </span>
            <span className="account-username">{account.username}</span>
          </Link>
          <button
            type="button"
            className="account-logout"
            disabled={busy}
            onClick={() => void logout()}
          >
            {busy ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            {busy ? "退出中…" : "退出登录"}
          </button>
        </>
      ) : error ? (
        <button type="button" className="account-logout" onClick={refresh}>
          {error}，重试
        </button>
      ) : (
        <Link href="/login" className="button-secondary">
          登录
        </Link>
      )}
      {failure && (
        <p className="account-error" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
