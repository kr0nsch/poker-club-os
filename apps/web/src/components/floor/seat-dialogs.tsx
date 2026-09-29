"use client";

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, cn } from "@pcos/ui";
import type { EntryView, SeatView, TableView } from "@pcos/types";
import { ArrowRightLeft, CircleDot, Coins, Crown, Lock, LockOpen, Plus, Skull, UserCheck, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useFormat, useT } from "@/lib/i18n";
import { useFloor } from "./floor-context";

export interface SeatRef {
  table: TableView;
  seat: SeatView;
}

/** Everything a floor person can do from a seat. */
export function SeatDialog({ target, onClose }: { target: SeatRef | null; onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const { snapshot, entries, run, pending } = useFloor();
  const [mode, setMode] = useState<"menu" | "eliminate" | "move" | "chips" | "assign">("menu");
  const [hunter, setHunter] = useState("");
  const [moveTable, setMoveTable] = useState("");
  const [moveSeat, setMoveSeat] = useState("");
  const [chips, setChips] = useState("");
  const [chipReason, setChipReason] = useState("");
  const [assignEntry, setAssignEntry] = useState("");
  // One idempotency key per dialog session: a retry after a network error reuses
  // it (never applied twice); the next action after closing gets a fresh key.
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  const close = () => {
    setOpId(crypto.randomUUID());
    setMode("menu");
    setHunter("");
    setMoveTable("");
    setMoveSeat("");
    setChips("");
    setChipReason("");
    setAssignEntry("");
    onClose();
  };
  const entry: EntryView | undefined = target?.seat.entryId ? entries.get(target.seat.entryId) : undefined;
  const t0 = snapshot.tournament;
  const activeOthers = useMemo(() => snapshot.entries.filter((e) => e.status === "ACTIVE" && e.id !== entry?.id), [snapshot.entries, entry?.id]);
  const unseated = useMemo(() => snapshot.entries.filter((e) => e.status === "ACTIVE" && e.tableId == null), [snapshot.entries]);
  const freeSeats = useMemo(() => {
    const table = snapshot.tables.find((x) => x.id === moveTable);
    return table ? table.seats.filter((s) => !s.entryId && !s.locked).map((s) => s.seatNumber) : [];
  }, [snapshot.tables, moveTable]);
  if (!target) return null;
  const { table, seat } = target;

  async function act(fn: () => Promise<unknown>) {
    const res = await fn();
    if (res) close();
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("Table")} {table.tableNumber} · {t("Seat")} {seat.seatNumber}
            {table.dealerButtonSeat === seat.seatNumber && <Badge variant="secondary">D</Badge>}
          </DialogTitle>
          <DialogDescription>
            {entry ? (
              <>
                <span className="text-base font-semibold text-foreground">{entry.playerName}</span> · #{entry.entryNumber} · {fmt.number(entry.chips)} {t("chips")}
                {entry.rebuys ? ` · R${entry.rebuys}` : ""}
                {entry.addons ? ` · A${entry.addons}` : ""}
              </>
            ) : seat.locked ? (
              t("Locked seat") + (seat.lockReason ? ` — ${seat.lockReason}` : "")
            ) : (
              t("Empty seat")
            )}
          </DialogDescription>
        </DialogHeader>

        {mode === "menu" && entry && (
          <div className="grid gap-2">
            <Button size="xl" variant="destructive" onClick={() => setMode("eliminate")}>
              <Skull /> {t("Eliminate")}
            </Button>
            {/* Two equal columns: long labels wrap inside the button instead of spilling over it on phones. */}
            <div className="grid grid-cols-2 gap-2 [&>button]:h-auto [&>button]:min-h-12 [&>button]:whitespace-normal [&>button]:py-2 [&>button]:leading-tight">
              <Button size="lg" variant="secondary" onClick={() => setMode("move")}>
                <ArrowRightLeft /> {t("Move")}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => act(() => run("DEALER_MARK_PRESENT", { tableId: table.id, seatNumber: seat.seatNumber, present: !seat.present }))}>
                <UserCheck /> {seat.present ? t("Mark absent") : t("Present")}
              </Button>
              {(t0.rebuyPolicy.enabled || t0.format === "REBUY") && (
                <Button size="lg" variant="outline" loading={pending} onClick={() => act(() => run("REBUY", { entryId: entry.id }, { success: t("Rebuy recorded"), clientOperationId: opId }))}>
                  <Plus /> {t("Rebuy")}
                </Button>
              )}
              {t0.addonPolicy.enabled && (
                <Button size="lg" variant="outline" loading={pending} onClick={() => act(() => run("ADD_ON", { entryId: entry.id }, { success: t("Add-on recorded"), clientOperationId: opId }))}>
                  <Plus /> {t("Add-on")}
                </Button>
              )}
              <Button size="lg" variant="outline" onClick={() => setMode("chips")}>
                <Coins /> {t("Chip adjustment")}
              </Button>
              <Button size="lg" variant="outline" onClick={() => act(() => run("SET_DEALER_BUTTON", { tableId: table.id, seatNumber: seat.seatNumber }))}>
                <CircleDot /> {t("Dealer button here")}
              </Button>
            </div>
          </div>
        )}

        {mode === "menu" && !entry && (
          <div className="grid gap-2">
            {!seat.locked && unseated.length > 0 && (
              <Button size="lg" onClick={() => setMode("assign")}>
                <UserPlus /> {t("Seat a player here")}
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={() => act(() => run("SET_SEAT_LOCK", { tableId: table.id, seatNumber: seat.seatNumber, locked: !seat.locked }))}>
              {seat.locked ? <LockOpen /> : <Lock />} {seat.locked ? t("Unlock seat") : t("Lock seat")}
            </Button>
          </div>
        )}

        {mode === "eliminate" && entry && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() =>
                run("ELIMINATE_PLAYERS", { entryIds: [entry.id], eliminatedByEntryId: hunter || null }, { success: t("{name} eliminated", { name: entry.playerName }), clientOperationId: opId }),
              );
            }}
          >
            <Field label={t("Eliminated by (optional, for bounties)")}>
              <Select value={hunter} onChange={(e) => setHunter(e.target.value)}>
                <option value="">—</option>
                {activeOthers
                  .slice()
                  .sort((a, b) => (a.tableId === table.id ? -1 : 0) - (b.tableId === table.id ? -1 : 0) || a.playerName.localeCompare(b.playerName))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.playerName} {o.tableNumber ? `(${t("T")}${o.tableNumber}/${t("S")}${o.seatNumber})` : ""}
                    </option>
                  ))}
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" size="lg" onClick={() => setMode("menu")}>
                {t("Back")}
              </Button>
              <Button type="submit" size="xl" variant="destructive" loading={pending}>
                <Skull /> {t("Confirm elimination")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {mode === "move" && entry && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!moveTable || !moveSeat) return;
              void act(() =>
                run(
                  "MOVE_PLAYER",
                  { entryId: entry.id, fromTableId: table.id, fromSeatNumber: seat.seatNumber, toTableId: moveTable, toSeatNumber: Number(moveSeat), reason: "MANUAL" },
                  { success: t("Player moved"), clientOperationId: opId },
                ),
              );
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("To table")}>
                <Select
                  value={moveTable}
                  onChange={(e) => {
                    setMoveTable(e.target.value);
                    setMoveSeat("");
                  }}
                  required
                >
                  <option value="">—</option>
                  {snapshot.tables
                    .filter((x) => x.status === "ACTIVE" || x.status === "OPEN")
                    .map((x) => (
                      <option key={x.id} value={x.id} disabled={x.seats.every((s) => s.entryId || s.locked)}>
                        {t("Table")} {x.tableNumber} ({x.occupied}/{x.capacity})
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t("Seat")}>
                <Select value={moveSeat} onChange={(e) => setMoveSeat(e.target.value)} required disabled={!moveTable}>
                  <option value="">—</option>
                  {freeSeats.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="lg" onClick={() => setMode("menu")}>
                {t("Back")}
              </Button>
              <Button type="submit" size="lg" loading={pending} disabled={!moveTable || !moveSeat}>
                <ArrowRightLeft /> {t("Move")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {mode === "chips" && entry && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(chips);
              if (!Number.isFinite(value) || value === 0 || chipReason.trim().length < 3) return;
              void act(() => run("CHIP_ADJUSTMENT", { entryId: entry.id, chips: Math.round(value), reason: chipReason.trim() }, { success: t("Chips adjusted"), clientOperationId: opId }));
            }}
          >
            <Field label={t("Chips (+/-)")}>
              <Input autoFocus inputMode="numeric" value={chips} onChange={(e) => setChips(e.target.value)} placeholder="-5000" />
            </Field>
            <Field label={t("Reason")}>
              <Input value={chipReason} onChange={(e) => setChipReason(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" size="lg" onClick={() => setMode("menu")}>
                {t("Back")}
              </Button>
              <Button type="submit" size="lg" loading={pending}>
                {t("Save")}
              </Button>
            </DialogFooter>
          </form>
        )}

        {mode === "assign" && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!assignEntry) return;
              void act(() => run("ASSIGN_SEAT", { entryId: assignEntry, seat: { tableId: table.id, seatNumber: seat.seatNumber } }, { success: t("Player seated"), clientOperationId: opId }));
            }}
          >
            <Field label={t("Unseated player")}>
              <Select value={assignEntry} onChange={(e) => setAssignEntry(e.target.value)} required autoFocus>
                <option value="">—</option>
                {unseated.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.playerName} #{u.entryNumber}
                  </option>
                ))}
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" size="lg" onClick={() => setMode("menu")}>
                {t("Back")}
              </Button>
              <Button type="submit" size="lg" loading={pending}>
                <UserPlus /> {t("Seat player")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SeatChip({ seat, table, onClick }: { seat: SeatView; table: TableView; onClick: () => void }) {
  const t = useT();
  const isButton = table.dealerButtonSeat === seat.seatNumber;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-12 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm transition-colors",
        seat.entryId ? "border-border bg-secondary/60 hover:bg-secondary" : seat.locked ? "border-dashed border-warning/40 bg-warning/5 text-warning" : "border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
      )}
      title={seat.playerName ?? (seat.locked ? t("Locked seat") : t("Empty seat"))}
    >
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", seat.entryId ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>{seat.seatNumber}</span>
      <span className="min-w-0 flex-1 truncate">{seat.playerName ?? (seat.locked ? <Lock className="size-3.5" /> : "—")}</span>
      {isButton && <Crown className="size-3.5 shrink-0 text-gold" aria-label="dealer button" />}
      {seat.entryId && !seat.present && <span className="size-1.5 shrink-0 rounded-full bg-warning" title={t("Not confirmed at the table")} />}
    </button>
  );
}
