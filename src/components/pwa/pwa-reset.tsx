"use client";

import { useEffect } from "react";

export function PwaReset() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    void (async () => {
      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
        }

        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch (error) {
        console.warn("[pwa-reset] failed to clear service workers or caches", error);
      }
    })();
  }, []);

  return null;
}
