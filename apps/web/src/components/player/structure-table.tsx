"use client";

import type { LevelView } from "@pcos/types";
import { cn, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import { Coffee, Timer } from "lucide-react";
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
    // Phones: tighter cells and unbroken figures, so "8 000 / 16 000" never splits after the slash.
    <Table className="max-sm:text-[13px] max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
      <THead>
        <Tr>
          <Th className="w-16 max-sm:w-10">{t("Level")}</Th>
          <Th>{t("Blinds")}</Th>
          <Th>{t("Ante")}</Th>
          <Th className="text-right">
            <span className="max-sm:sr-only">{t("Duration")}</span>
            <Timer className="ml-auto size-3.5 sm:hidden" aria-hidden />
          </Th>
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
                    {current && <span className="rounded-[5px] bg-gold px-1.5 text-xs font-semibold leading-5 text-gold-foreground">{t("Now")}</span>}
                  </span>
                </Td>
                <Td className="text-right tabular-nums text-gold">{tt.minutes(l.durationSeconds)}</Td>
              </Tr>
            );
          }
          const ante = anteLabel(l, f.number);
          return (
            <Tr key={l.id} className={cn(current && "bg-gold/10 hover:bg-gold/15")}>
              <Td className="font-medium tabular-nums">
                <span className="flex items-center gap-2">
                  {n}
                  {current && <span className="rounded-[5px] bg-gold px-1.5 text-xs font-semibold leading-5 text-gold-foreground">{t("Now")}</span>}
                </span>
              </Td>
              <Td className="whitespace-nowrap font-semibold tabular-nums">{tt.blinds(l)}</Td>
              <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
                {ante ? (
                  <>
                    {ante}
                    {l.anteType === "BIG_BLIND" && <span className="ml-1 text-[10px] font-semibold uppercase">BB</span>}
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{tt.minutes(l.durationSeconds)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
