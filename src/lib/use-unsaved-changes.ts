"use client";

import { useEffect, useRef } from "react";

interface NavigationEvent extends Event {
  destination: { url: string };
}

/** Chromium Navigation API covers SPA links and history traversal; unload remains a fallback. */
export function useUnsavedChanges(isDirty: boolean): () => void {
  const active = useRef(false);
  useEffect(() => {
    active.current = isDirty;
  }, [isDirty]);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent): void {
      if (!active.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function shouldLeave(url: string): boolean {
      const target = new URL(url, window.location.href);
      if (
        !active.current ||
        (target.origin === location.origin && target.pathname === location.pathname)
      )
        return true;
      const confirmed = window.confirm("有尚未保存的编辑。离开将丢失这些内容，是否继续？");
      if (confirmed) active.current = false;
      return confirmed;
    }
    function navigate(event: Event): void {
      if (!event.cancelable) return;
      const destination = (event as NavigationEvent).destination;
      if (destination && !shouldLeave(destination.url)) event.preventDefault();
    }
    function click(event: MouseEvent): void {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (!shouldLeave(anchor.href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    window.addEventListener("beforeunload", beforeUnload);
    if (navigation) navigation.addEventListener("navigate", navigate);
    // Stop Link before Next.js changes its React tree; cancelling pushState alone is too late.
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      navigation?.removeEventListener("navigate", navigate);
      document.removeEventListener("click", click, true);
    };
  }, []);
  return () => {
    active.current = false;
  };
}
