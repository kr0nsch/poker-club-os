"use client";

import { Spade } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Last-resort screen for unattended devices (TV, kiosk): calm message and an
 * automatic reload, so nobody has to walk up to the screen with a keyboard.
 */
export function DeviceCrashScreen({ error, reloadAfterSeconds = 20 }: { error: Error; reloadAfterSeconds?: number }) {
  const t = useT();
  const [left, setLeft] = useState(reloadAfterSeconds);
  useEffect(() => {
    console.error(error);
    const id = setInterval(() => setLeft((s) => s - 1), 1_000);
    return () => clearInterval(id);
  }, [error]);
  useEffect(() => {
    if (left <= 0) window.location.reload();
  }, [left]);
  return (
    <div className="grid h-dvh w-screen place-items-center bg-[#050b09] text-center text-white" onClick={() => window.location.reload()}>
      <div className="grid justify-items-center gap-4">
        <Spade className="size-16 text-primary" fill="currentColor" />
        <div className="text-2xl font-semibold">{t("Restarting…")}</div>
        <div className="text-white/60 tabular-nums">{t("The screen reloads in {n} s.", { n: Math.max(0, left) })}</div>
      </div>
    </div>
  );
}
