"use client";

import { useEffect, useState } from "react";
import { suggestDeviceType } from "@/lib/device";
import { useI18n } from "@/lib/i18n";

/** Keep the screen on (Screen Wake Lock API), re-acquired whenever the page becomes visible again. */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const request = async () => {
      if (disposed || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (disposed) void sentinel.release().catch(() => undefined);
      } catch {
        /* not allowed (battery saver, insecure context): the OS settings must keep the screen on */
      }
    };
    void request();
    const onVisible = () => void request();
    document.addEventListener("visibilitychange", onVisible);
    // Some browsers drop the lock silently; re-check periodically.
    const id = setInterval(onVisible, 60_000);
    return () => {
      disposed = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}

/** true after `ms` without mouse movement: used to hide the cursor on TVs. */
export function useIdleCursor(ms = 3_000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, [ms]);
  return idle;
}

/**
 * Venue devices: declare the device type, and honour `?lang=ru|en` in the URL
 * so a TV or kiosk can be pinned to a language without a keyboard.
 */
export function useVenueDevice(type: "DISPLAY" | "KIOSK") {
  const { setLocale } = useI18n();
  useEffect(() => {
    suggestDeviceType(type);
    const lang = new URLSearchParams(window.location.search).get("lang");
    if (lang === "ru" || lang === "en") setLocale(lang);
  }, [type, setLocale]);
}
