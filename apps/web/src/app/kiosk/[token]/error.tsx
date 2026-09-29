"use client";

import { DeviceCrashScreen } from "@/components/display/device-error";

export default function KioskError({ error }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DeviceCrashScreen error={error} reloadAfterSeconds={10} />;
}
