"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { ReactElement } from "react";
export function BrowseBack({ href, label }: { href: string; label: string }): ReactElement {
  return (
    <Link href={href} scroll={false} className="button-secondary">
      ← {label}
    </Link>
  );
}
export function BrowsePosition({ identity }: { identity: string }): null {
  const pathname = usePathname(),
    query = useSearchParams().toString();
  useEffect(() => {
    const parameters = new URLSearchParams(query);
    if (parameters.get("page") === "1") parameters.delete("page");
    parameters.sort();
    const key = `browse:${identity}:${pathname}?${parameters.toString()}`;
    const saved = sessionStorage.getItem(key);
    const frame = saved
      ? requestAnimationFrame(() =>
          window.scrollTo({ top: Number(saved) || 0, behavior: "instant" }),
        )
      : undefined;
    const save = (): void => {
      // Next.js may scroll the destination before this page's effect is cleaned up.
      // Only write while the browser still displays this list and its filters.
      if (
        window.location.pathname === pathname &&
        new URLSearchParams(window.location.search).toString() === query
      )
        sessionStorage.setItem(key, String(scrollY));
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", save);
    };
  }, [identity, pathname, query]);
  return null;
}
