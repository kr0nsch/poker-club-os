"use client";

import type { LevelView } from "@pcos/types";
import { cn, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import { Coffee } from "lucide-react";
import { anteLabel } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";
import { useTournamentText } from "./labels";

/** Blind structure; the level in play (if any) is highlighted. */
export function StructureTable({ levels, currentIndex }: { levels: readonly LevelView[]; currentIndex?: number | null }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  let playNo = 0;
  const rows = levels.map((l, i) => {
    if (l.type === "PLAY") playNo++;
    return { l, i, n: playNo };
  });
  return (
    <Table>
      <THead>
        <Tr>
          <Th className="w-16">{t("Level")}</Th>
          <Th>{t("Blinds")}</Th>
          <Th>{t("Ante")}</Th>
          <Th className="text-right">{t("Duration")}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map(({ l, i, n }) => {
          const current = currentIndex === i;
          if (l.type === "BREAK") {
            return (
              <Tr key={l.id} className={cn("bg-gold/5 hover:bg-gold/10", current && "bg-gold/15")}>
                <Td colSpan={3} className="text-gold">
                  <span className="flex items-center gap-2 font-medium">
                    <Coffee className="size-4" />
                    {l.label || t("Break")}
                    {current && <span className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase text-black">{t("Now")}</span>}
                  </span>
                </Td>
                <Td className="text-right tabular-nums text-gold">{tt.minutes(l.durationSeconds)}</Td>
              </Tr>
            );
          }
          const ante = anteLabel(l, f.number);
          return (
            <Tr key={l.id} className={cn(current && "bg-primary/15 hover:bg-primary/20")}>
              <Td className="font-medium tabular-nums">
                <span className="flex items-center gap-2">
                  {n}
                  {current && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">{t("Now")}</span>}
                </span>
              </Td>
              <Td className="font-semibold tabular-nums">{tt.blinds(l)}</Td>
              <Td className="tabular-nums text-muted-foreground">
                {ante ? (
                  <>
                    {ante}
                    {l.anteType === "BIG_BLIND" && <span className="ml-1 text-[10px] font-semibold uppercase">BB</span>}
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="text-right tabular-nums text-muted-foreground">{tt.minutes(l.durationSeconds)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
