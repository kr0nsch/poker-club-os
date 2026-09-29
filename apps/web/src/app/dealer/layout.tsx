"use client";

import { useEffect, type ReactNode } from "react";
import { StaffGuard } from "@/components/staff-guard";
import { suggestDeviceType } from "@/lib/device";
import { RealtimeProvider } from "@/lib/realtime-context";

export default function DealerLayout({ children }: { children: ReactNode }) {
  useEffect(() => suggestDeviceType("DEALER_TABLET"), []);
  return (
    <StaffGuard>
      <RealtimeProvider>{children}</RealtimeProvider>
    </StaffGuard>
  );
}
