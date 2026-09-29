"use client";

import { useParams } from "next/navigation";
import { Kiosk } from "@/components/display/kiosk";
import { RealtimeProvider } from "@/lib/realtime-context";

export default function KioskPage() {
  const { token } = useParams<{ token: string }>();
  return (
    <RealtimeProvider params={{ kiosk: token }}>
      <Kiosk token={token} />
    </RealtimeProvider>
  );
}
