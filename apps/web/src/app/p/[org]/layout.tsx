import type { ReactNode } from "react";
import { PlayerLayout } from "@/components/player/player-shell";

export default async function PlayerOrgLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <PlayerLayout org={org}>{children}</PlayerLayout>;
}
