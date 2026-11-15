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
    if (saved) requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
    const save = (): void => sessionStorage.setItem(key, String(scrollY));
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [identity, pathname, query]);
  return null;
}
