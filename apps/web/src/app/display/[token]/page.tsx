"use client";

import { useParams } from "next/navigation";
import { TvDisplay } from "@/components/display/tv-display";
import { RealtimeProvider } from "@/lib/realtime-context";

export default function DisplayPage() {
  const { token } = useParams<{ token: string }>();
  return (
    <RealtimeProvider params={{ display: token }}>
      <TvDisplay token={token} />
    </RealtimeProvider>
  );
}
