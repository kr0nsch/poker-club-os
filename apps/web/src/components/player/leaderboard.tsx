"use client";

import { cn, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import { useFormat, useT } from "@/lib/i18n";
import type { PublicLeague } from "./api";

export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  // Medal colours carry meaning (gold, silver, bronze), so they stay coloured in the monochrome UI.
  const tone = rank === 1 ? "bg-[#e3c16f] text-black" : rank === 2 ? "bg-slate-300 text-black" : rank === 3 ? "bg-amber-700 text-white" : "bg-white/[0.06] text-muted-foreground";
  return <span className={cn("inline-grid size-7 place-items-center rounded-full text-xs font-bold tabular-nums", tone, className)}>{rank}</span>;
}

export function LeagueTable({ league, highlightPlayerId, limit }: { league: PublicLeague; highlightPlayerId?: string | null; limit?: number }) {
  const t = useT();
  const f = useFormat();
  const rows = limit ? league.rows.slice(0, limit) : league.rows;
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("No results in this season yet.")}</p>;
  return (
    <Table>
      <THead>
        <Tr>
          <Th className="w-12">#</Th>
          <Th>{t("Player")}</Th>
          <Th className="text-right">{t("Points")}</Th>
          <Th className="hidden text-right sm:table-cell">{t("Played")}</Th>
          <Th className="hidden text-right sm:table-cell">{t("Wins")}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => {
          const me = !!highlightPlayerId && r.playerId === highlightPlayerId;
          return (
            <Tr key={r.playerId} className={cn(me && "bg-primary/10 hover:bg-primary/15")}>
              <Td>
                <RankBadge rank={r.rank} />
              </Td>
              <Td className={cn("font-medium", me && "text-primary")}>
                {r.playerName}
                {me && <span className="ml-2 text-xs font-normal text-muted-foreground">({t("you")})</span>}
              </Td>
              <Td className="text-right font-semibold tabular-nums">{f.number(r.points)}</Td>
              <Td className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{f.number(r.tournaments)}</Td>
              <Td className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{f.number(r.wins)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
