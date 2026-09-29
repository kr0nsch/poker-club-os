"use client";

import { useEffect, type ReactNode } from "react";
import { StaffGuard } from "@/components/staff-guard";
import { suggestDeviceType } from "@/lib/device";
import { RealtimeProvider } from "@/lib/realtime-context";

export default function FloorLayout({ children }: { children: ReactNode }) {
  useEffect(() => suggestDeviceType("TD_TABLET"), []);
  return (
    <StaffGuard>
      <RealtimeProvider>{children}</RealtimeProvider>
    </StaffGuard>
  );
}
