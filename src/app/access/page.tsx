"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactElement, FormEvent } from "react";
export default function AccessPage(): ReactElement {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  async function login(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) {
        setToken("");
        router.push("/");
        router.refresh();
      } else setMessage((await response.json()).error);
    } catch {
      setMessage("本地服务连接失败。");
    }
  }
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">本地访问身份</h1>
      <p className="my-4 text-sm">输入本机管理员分配的访问凭据。凭据不进入聊天或项目仓库。</p>
      <form onSubmit={login}>
        <label>
          访问凭据
          <input
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="my-3 block w-full rounded border p-2"
          />
        </label>
        <button className="rounded bg-primary px-4 py-2 text-primary-foreground">登录</button>
      </form>
      <p role="status">{message}</p>
      <button
        className="mt-6 underline"
        onClick={async () => {
          await fetch("/api/access", { method: "DELETE" });
          setMessage("已退出当前身份。");
        }}
      >
        退出当前身份
      </button>
    </main>
  );
}
