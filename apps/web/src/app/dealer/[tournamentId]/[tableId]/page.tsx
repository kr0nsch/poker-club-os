"use client";

import { Alert, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Skeleton, cn } from "@pcos/ui";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Check, Crown, Hand, LogIn, Skull, UserCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/floor/dialogs";
import { FloorHeader } from "@/components/floor/floor-header";
import { get } from "@/lib/api";
import { anteLabel, blindsLabel, useDerivedClock } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage, useCommand, useTournamentSnapshot } from "@/lib/queries";

interface Movement {
  id: string;
  entryId: string;
  playerId: string;
  fromTableNumber: number | null;
  fromSeat: number | null;
  toTableId: string | null;
  toTableNumber: number | null;
  toSeat: number | null;
  reason: string;
  confirmedAt: string | null;
  createdAt: string;
}

/**
 * Dealer view of one table (spec §61): seats, presence, bust reports (the
 * floor confirms eliminations), floor calls and arrival of moved players.
 * No administrative or financial functions.
 */
export default function DealerTable() {
  const t = useT();
  const fmt = useFormat();
  const { tournamentId, tableId } = useParams<{ tournamentId: string; tableId: string }>();
  const snap = useTournamentSnapshot(tournamentId);
  const command = useCommand(tournamentId);
  const [bust, setBust] = useState<number | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [message, setMessage] = useState("");
  const movements = useQuery({
    queryKey: ["tournament", tournamentId, "movements", snap.data?.tournament.version],
    queryFn: () => get<Movement[]>(`/api/v1/tournaments/${tournamentId}/movements`),
    enabled: !!snap.data,
    placeholderData: (p) => p,
  });
  const clock = useDerivedClock(snap.data?.clock, snap.data?.levels);

  if (!snap.data) {
    return (
      <div className="min-h-dvh">
        <FloorHeader back="/dealer" title={<Skeleton className="h-5 w-40" />} />
        <main className="p-4">{snap.error ? <Alert variant="destructive">{errorMessage(snap.error)}</Alert> : <Skeleton className="h-96" />}</main>
      </div>
    );
  }
  const s = snap.data;
  const table = s.tables.find((x) => x.id === tableId);
  const level = clock ? s.levels[clock.levelIndex] : undefined;
  const n = (v: number) => fmt.number(v);
  const names = new Map(s.entries.map((e) => [e.id, e.playerName]));
  const arrivals = (movements.data ?? []).filter((m) => m.toTableId === tableId && !m.confirmedAt && m.reason !== "INITIAL_SEATING");
  const run = (type: Parameters<typeof command.mutateAsync>[0]["type"], payload: Record<string, unknown>, success?: string) =>
    command.mutateAsync({ type, payload }).then(
      (r) => {
        if (success) toast.success(success);
        return r;
      },
      () => null,
    );

  return (
    <div className="min-h-dvh">
      <FloorHeader
        back="/dealer"
        width="max-w-4xl"
        title={
          <span className="truncate text-lg font-semibold">
            {t("Table")} {table?.tableNumber ?? "?"} · <span className="text-muted-foreground">{s.tournament.name}</span>
          </span>
        }
      />
      <main className="mx-auto grid max-w-4xl gap-4 p-3 md:p-4">
        {/* Hand-for-hand changes how the dealer runs the table: a full-width strip, not a small tag. */}
        {s.tournament.status === "HAND_FOR_HAND" && (
          <div className="fade-in flex items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-3 text-lg font-semibold text-destructive-foreground">
            <Hand className="size-5" /> {t("Hand-for-hand")}
          </div>
        )}
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm text-muted-foreground">{clock?.isBreak ? t("Break") : `${t("Level")} ${clock?.playLevelNumber ?? 1}`}</div>
            <div className="text-3xl font-bold tabular-nums">
              {level && level.type === "PLAY" ? blindsLabel(level, n) : t("Break")}
              {anteLabel(level, n) && <span className="ml-2 text-lg font-normal text-muted-foreground">{t("Ante")} {anteLabel(level, n)}</span>}
            </div>
          </div>
          <div className={cn("clock-digits text-5xl font-bold", s.tournament.status === "PAUSED" && "text-warning/70")}>{clock?.formatted ?? "--:--"}</div>
        </Card>

        {!table && <Alert variant="warning">{t("This table is not part of the tournament any more.")}</Alert>}
        {table?.status === "CLOSED" && <Alert variant="warning">{t("This table has been broken. Players were moved to other tables.")}</Alert>}

        {arrivals.length > 0 && (
          <Card className="border-gold/35 bg-gold/[0.05] p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold text-gold">
              <LogIn className="size-4" /> {t("Players moving to this table")}
            </div>
            <div className="grid gap-2">
              {arrivals.map((m) => (
                <div key={m.id} className="fade-in flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <span className="min-w-0 flex-[1_1_12rem] text-lg">
                    <b>{names.get(m.entryId) ?? "?"}</b> → {t("Seat")} {m.toSeat}
                    <span className="ml-2 text-sm text-muted-foreground">
                      ({t("from table {n}", { n: m.fromTableNumber ?? "?" })})
                    </span>
                  </span>
                  <Button size="lg" className="ml-auto" onClick={() => run("DEALER_CONFIRM_MOVEMENT", { movementId: m.id }, t("Arrival confirmed"))}>
                    <Check /> {t("Arrived")}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {table && (
          <div className="grid gap-2 sm:grid-cols-2">
            {table.seats.map((seat) => (
              <Card key={seat.seatNumber} className={cn("flex items-center gap-3 p-3", !seat.entryId && "opacity-60")}>
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/15 text-xl font-bold text-primary">{seat.seatNumber}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-semibold">
                    {seat.playerName ?? (seat.locked ? t("Locked seat") : t("Empty seat"))}
                    {table.dealerButtonSeat === seat.seatNumber && <Crown className="ml-2 inline size-4 text-gold" />}
                  </div>
                  {seat.entryId && <div className="text-xs text-muted-foreground">{seat.present ? t("At the table") : t("Not confirmed at the table")}</div>}
                </div>
                {seat.entryId && (
                  <>
                    <Button
                      size="lg"
                      variant={seat.present ? "secondary" : "outline"}
                      aria-pressed={seat.present}
                      onClick={() => run("DEALER_MARK_PRESENT", { tableId, seatNumber: seat.seatNumber, present: !seat.present })}
                    >
                      <UserCheck />
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="border-destructive/45 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setBust(seat.seatNumber)}
                      aria-label={t("Report bust")}
                      title={t("Report bust")}
                    >
                      <Skull />
                    </Button>
                  </>
                )}
              </Card>
            ))}
          </div>
        )}

        <Button size="xl" variant="warning" className="h-20 text-xl" onClick={() => setCallOpen(true)}>
          <BellRing /> {t("Call floor")}
        </Button>
      </main>

      <ConfirmDialog
        open={bust !== null}
        onOpenChange={(o) => !o && setBust(null)}
        title={t("Report bust at seat {n}?", { n: bust ?? "" })}
        description={t("The floor confirms the elimination.")}
        confirmLabel={t("Report bust")}
        destructive
        onConfirm={() => run("DEALER_REPORT_BUST", { tableId, seatNumber: bust }, t("Bust reported to the floor"))}
      />
      <Dialog open={callOpen} onOpenChange={setCallOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run("DEALER_REQUEST_FLOOR", { tableId, message: message.trim() || undefined }, t("Floor called"));
              if (r) {
                setCallOpen(false);
                setMessage("");
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("Call floor")}</DialogTitle>
            </DialogHeader>
            <Field label={t("Message (optional)")}>
              <Input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} placeholder={t("e.g. ruling needed, chip count, clock")} />
            </Field>
            <DialogFooter>
              <Button type="submit" size="xl" variant="warning" loading={command.isPending}>
                <BellRing /> {t("Call floor")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
