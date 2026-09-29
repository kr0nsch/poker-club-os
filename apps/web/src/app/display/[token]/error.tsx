"use client";

import { DeviceCrashScreen } from "@/components/display/device-error";

export default function DisplayError({ error }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DeviceCrashScreen error={error} />;
}
