"use client";

import type { PublicLiveSnapshot } from "@pcos/types";
import { cn, Input } from "@pcos/ui";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";

type Row = NonNullable<PublicLiveSnapshot["seating"]>[number];

const MAX_ROWS = 300;
const norm = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Public seat list with name search ("where do I sit?"). Typing a number filters by table. */
export function SeatingList({ seating, mySeat }: { seating: Row[]; mySeat?: PublicLiveSnapshot["mySeat"] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "table">("name");

  const rows = useMemo(() => {
    const query = norm(q.trim());
    let out = seating;
    if (query) {
      out = /^\d+$/.test(query) ? seating.filter((r) => String(r.tableNumber) === query) : seating.filter((r) => norm(r.playerName).includes(query));
    }
    if (sort === "table") out = [...out].sort((a, b) => a.tableNumber - b.tableNumber || a.seatNumber - b.seatNumber);
    return out;
  }, [seating, q, sort]);

  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Find your name or a table number")}
            className="h-11 pl-9 text-base"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label={t("Search")}
          />
        </div>
        <div className="inline-flex shrink-0 rounded-md border border-border p-0.5 text-xs" role="group" aria-label={t("Sort")}>
          {(["name", "table"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={cn("rounded px-2.5 font-medium", sort === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {s === "name" ? t("A–Z") : t("Table")}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {seating.length === 0 ? t("Seats have not been drawn yet.") : t("No player matches your search.")}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {rows.slice(0, MAX_ROWS).map((r) => {
            const mine = !!mySeat && mySeat.tableNumber === r.tableNumber && mySeat.seatNumber === r.seatNumber;
            return (
              <li key={`${r.tableNumber}-${r.seatNumber}-${r.playerName}`} className={cn("flex items-center justify-between gap-3 px-4 py-2.5", mine && "bg-gold/10")}>
                <span className={cn("min-w-0 truncate font-medium", mine && "text-gold")}>{r.playerName}</span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {t("Table")} <span className="font-semibold text-foreground">{r.tableNumber}</span> · {t("Seat")} <span className="font-semibold text-foreground">{r.seatNumber}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > MAX_ROWS && <p className="text-center text-xs text-muted-foreground">{t("Type a name to narrow the list.")}</p>}
    </div>
  );
}
