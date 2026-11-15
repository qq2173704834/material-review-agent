"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function notifyScheduleChanged(): void {
  window.dispatchEvent(new Event("personal-schedule-changed"));
  try {
    localStorage.setItem("personal-schedule-changed", crypto.randomUUID());
  } catch {
    /* Optional cross-tab signal. */
  }
}
/** Refresh server projections on return to a tab and on changes made in another tab. */
export function ScheduleRefresh(): null {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (): void => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };
    const storage = (event: StorageEvent): void => {
      if (event.key === "personal-schedule-changed") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", storage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", storage);
    };
  }, [router]);
  return null;
}
