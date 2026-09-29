"use client";

import { Button, Card } from "@pcos/ui";
import { BellRing, Check, Skull } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFormat, useT } from "@/lib/i18n";
import { useFloor } from "./floor-context";

/** Short local beep (no audio files: works offline). */
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    /* audio not allowed yet */
  }
}

/** Dealer calls and bust reports waiting for the floor (spec §61). */
export function FloorRequests() {
  const t = useT();
  const fmt = useFormat();
  const { snapshot, run, pending } = useFloor();
  const open = snapshot.floorRequests.filter((r) => r.status !== "RESOLVED");
  // Beep only for requests that arrive while the page is open.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(open.map((r) => r.id));
      return;
    }
    let fresh = false;
    for (const r of open) {
      if (!seen.current.has(r.id)) {
        fresh = true;
        seen.current.add(r.id);
      }
    }
    if (fresh) beep();
  }, [open]);
  if (open.length === 0) return null;
  return (
    <Card className="border-warning/35 bg-warning/[0.06] p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
        <BellRing className="size-4" /> {t("Floor requests")} ({open.length})
      </div>
      <div className="grid gap-2">
        {open.map((r) => {
          const entryId = r.kind === "BUST_REPORT" && r.message?.startsWith("entry:") ? r.message.slice(6) : null;
          const entry = entryId ? snapshot.entries.find((e) => e.id === entryId) : undefined;
          return (
            // The text takes the row when there is room; on a phone the actions drop below it, right-aligned.
            <div key={r.id} className="fade-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card px-3 py-2">
              <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-baseline gap-x-2">
                <span className="text-xs tabular-nums text-muted-foreground">{fmt.time(r.createdAt)}</span>
                <span className="font-semibold">
                  {t("Table")} {r.tableNumber}
                  {r.seatNumber ? ` · ${t("Seat")} ${r.seatNumber}` : ""}
                </span>
                <span className="text-sm">
                  {r.kind === "BUST_REPORT" ? t("Bust reported: {name}", { name: entry?.playerName ?? "?" }) : r.message || t("Floor called to the table")}
                </span>
              </div>
              <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                {r.kind === "BUST_REPORT" && entry?.status === "ACTIVE" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={pending}
                    onClick={async () => {
                      const res = await run("ELIMINATE_PLAYERS", { entryIds: [entry.id] }, { success: t("{name} eliminated", { name: entry.playerName }) });
                      if (res) await run("RESOLVE_FLOOR_REQUEST", { requestId: r.id, resolution: "RESOLVED" });
                    }}
                  >
                    <Skull /> {t("Confirm elimination")}
                  </Button>
                )}
                {r.status === "OPEN" && r.kind === "CALL_FLOOR" && (
                  <Button size="sm" variant="outline" onClick={() => run("RESOLVE_FLOOR_REQUEST", { requestId: r.id, resolution: "ACKNOWLEDGED" })}>
                    {t("On my way")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => run("RESOLVE_FLOOR_REQUEST", { requestId: r.id, resolution: "RESOLVED" })}>
                  <Check /> {t("Resolve")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
