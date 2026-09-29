"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Spinner,
  cn,
} from "@pcos/ui";
import type { PlannedMove, TableView } from "@pcos/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LayoutGrid, MoreVertical, Plus, Scale, Scissors, Shuffle, UserPlus, XCircle } from "lucide-react";
import { useState } from "react";
import { breakReason, moveExplanation } from "@/lib/action-summary";
import { get } from "@/lib/api";
import { errorMessage } from "@/lib/queries";
import { useT } from "@/lib/i18n";
import { useFloor } from "./floor-context";
import { ConfirmDialog } from "./dialogs";
import { SeatChip, SeatDialog, type SeatRef } from "./seat-dialogs";

interface PlanMove extends PlannedMove {
  playerName: string;
  fromTableNumber: number | null;
  toTableNumber: number;
  explanation: string;
}
interface BalancePreview {
  basedOnVersion: number;
  analysis: { balanced: boolean; imbalance: number; severe: boolean };
  haltPlay: boolean;
  moves: PlanMove[];
  tableBreak: { shouldBreak: boolean; tableId: string | null; tableNumber: number | null; reason: string };
}
interface BreakPreview {
  basedOnVersion: number;
  tableId: string | null;
  tableNumber?: number;
  moves: PlanMove[];
  recommendation: { reason: string };
}

const stripPlan = (m: PlanMove): PlannedMove => ({ entryId: m.entryId, fromTableId: m.fromTableId, fromSeatNumber: m.fromSeatNumber, toTableId: m.toTableId, toSeatNumber: m.toSeatNumber });

function MovesList({ moves }: { moves: PlanMove[] }) {
  const t = useT();
  return (
    <div className="grid max-h-80 gap-1.5 overflow-y-auto">
      {moves.map((m) => (
        <div key={m.entryId} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{m.playerName}</span>
          <span className="tabular-nums text-muted-foreground">
            {t("T")}
            {m.fromTableNumber}/{m.fromSeatNumber}
          </span>
          <ArrowRight className="size-4 text-primary" />
          <span className="font-semibold tabular-nums">
            {t("T")}
            {m.toTableNumber}/{m.toSeatNumber}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TablesView() {
  const t = useT();
  const qc = useQueryClient();
  const { id, snapshot, run, pending } = useFloor();
  const [seatTarget, setSeatTarget] = useState<SeatRef | null>(null);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [breakTable, setBreakTable] = useState<string | null | undefined>(undefined);
  const [confirmDraw, setConfirmDraw] = useState(false);
  const [closeTable, setCloseTable] = useState<TableView | null>(null);
  const version = snapshot.tournament.version;
  const status = snapshot.tournament.status;
  const seatingOpen = ["REGISTRATION_OPEN", "SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"].includes(status);
  const canBalance = ["SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"].includes(status);

  // Recommendation follows every change of the tournament (cheap on the LAN).
  const hint = useQuery({
    queryKey: ["tournament", id, "balance", version],
    queryFn: () => get<BalancePreview>(`/api/v1/tournaments/${id}/balance/preview`),
    enabled: canBalance && snapshot.tables.length > 1,
    staleTime: 60_000,
  });
  const balance = useQuery({
    queryKey: ["tournament", id, "balance-plan"],
    queryFn: () => get<BalancePreview>(`/api/v1/tournaments/${id}/balance/preview`),
    enabled: balanceOpen,
    staleTime: 0,
    gcTime: 0,
  });
  const brk = useQuery({
    queryKey: ["tournament", id, "break-plan", breakTable],
    queryFn: () => get<BreakPreview>(`/api/v1/tournaments/${id}/break/preview${breakTable ? `?tableId=${breakTable}` : ""}`),
    enabled: breakTable !== undefined,
    staleTime: 0,
    gcTime: 0,
  });

  const unseated = snapshot.entries.filter((e) => e.status === "ACTIVE" && e.tableId == null);
  const tables = snapshot.tables.filter((x) => x.status !== "CLOSED");
  // The dialog always shows the latest state of the seat (other devices may act meanwhile).
  const liveTable = seatTarget ? snapshot.tables.find((x) => x.id === seatTarget.table.id) : undefined;
  const liveSeat = liveTable?.seats.find((s) => s.seatNumber === seatTarget?.seat.seatNumber);
  const liveTarget = liveTable && liveSeat ? { table: liveTable, seat: liveSeat } : null;
  const closed = snapshot.tables.filter((x) => x.status === "CLOSED");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="lg" disabled={!seatingOpen} onClick={() => run("ADD_TABLES", { count: 1 }, { success: t("Table added") })}>
          <Plus /> {t("Add table")}
        </Button>
        <Button variant="secondary" size="lg" disabled={!canBalance || snapshot.tables.length < 2} onClick={() => setBalanceOpen(true)}>
          <Scale /> {t("Balance tables")}
        </Button>
        <Button variant="secondary" size="lg" disabled={!canBalance || tables.length < 2} onClick={() => setBreakTable(null)}>
          <Scissors /> {t("Break table")}
        </Button>
        {unseated.length > 0 && seatingOpen && status !== "REGISTRATION_OPEN" && (
          <Button size="lg" onClick={() => setConfirmDraw(true)}>
            <Shuffle /> {t("Seat {n} unseated", { n: unseated.length })}
          </Button>
        )}
      </div>

      {hint.data && !hint.data.analysis.balanced && (
        <Alert variant={hint.data.haltPlay ? "destructive" : "warning"} title={t("Tables need balancing")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t("Imbalance of {n} players between tables.", { n: hint.data.analysis.imbalance })} {hint.data.haltPlay && t("Halt play until tables are balanced.")}
            </span>
            <Button size="sm" variant="warning" onClick={() => setBalanceOpen(true)}>
              {t("Review moves")}
            </Button>
          </div>
        </Alert>
      )}
      {hint.data?.tableBreak.shouldBreak && (
        <Alert variant="warning" title={t("A table should break")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{breakReason(hint.data.tableBreak.reason, t)}</span>
            <Button size="sm" variant="warning" onClick={() => setBreakTable(hint.data!.tableBreak.tableId)}>
              {t("Break table {n}", { n: hint.data.tableBreak.tableNumber ?? "" })}
            </Button>
          </div>
        </Alert>
      )}

      {unseated.length > 0 && (
        <Card className="p-3">
          <div className="mb-2 text-sm font-medium">
            {t("Unseated players")} <Badge variant="warning">{unseated.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {unseated.map((u) => (
              <Button key={u.id} size="sm" variant="outline" disabled={!seatingOpen || status === "REGISTRATION_OPEN"} onClick={() => run("ASSIGN_SEAT", { entryId: u.id, seat: "AUTO" }, { success: t("Player seated") })}>
                <UserPlus /> {u.playerName}
              </Button>
            ))}
          </div>
          {status === "REGISTRATION_OPEN" && <p className="mt-2 text-xs text-muted-foreground">{t("Players are seated by random draw when seating starts.")}</p>}
        </Card>
      )}

      {tables.length === 0 ? (
        <EmptyState icon={<LayoutGrid />} title={t("No tables yet")} description={t("Tables open automatically at the seat draw, or add them manually.")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((table) => (
            <Card key={table.id} className={cn("p-3", table.status === "BREAKING" && "border-warning/60")}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">
                    {t("Table")} {table.tableNumber}
                  </span>
                  <Badge variant={table.occupied === 0 ? "muted" : "secondary"}>
                    {table.occupied}/{table.capacity}
                  </Badge>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("Table actions")}>
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={!canBalance || tables.length < 2} onSelect={() => setBreakTable(table.id)}>
                      <Scissors /> {t("Break this table")}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={table.occupied > 0} onSelect={() => setCloseTable(table)}>
                      <XCircle /> {t("Close empty table")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {table.seats.map((seat) => (
                  <SeatChip key={seat.seatNumber} seat={seat} table={table} onClick={() => setSeatTarget({ table, seat })} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("Closed tables")}: {closed.map((c) => c.tableNumber).join(", ")}
        </p>
      )}

      <SeatDialog target={liveTarget} onClose={() => setSeatTarget(null)} />

      <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{t("Balance tables")}</DialogTitle>
            <DialogDescription>{t("Recommended moves (house rules). Review and confirm — players move only after you apply.")}</DialogDescription>
          </DialogHeader>
          {balance.isLoading && <Spinner />}
          {balance.error && <Alert variant="destructive">{errorMessage(balance.error)}</Alert>}
          {balance.data && (balance.data.moves.length === 0 ? <Alert variant="success">{t("Tables are balanced.")}</Alert> : <MovesList moves={balance.data.moves} />)}
          {balance.data && balance.data.moves.length > 0 && <p className="text-xs text-muted-foreground">{moveExplanation(balance.data.moves[0]!.explanation, t)}</p>}
          <DialogFooter>
            <Button variant="ghost" size="lg" onClick={() => setBalanceOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              size="lg"
              disabled={!balance.data || balance.data.moves.length === 0}
              loading={pending}
              onClick={async () => {
                const res = await run("APPLY_BALANCE", { moves: balance.data!.moves.map(stripPlan) }, { expectedVersion: balance.data!.basedOnVersion, success: t("Tables balanced") });
                if (res) setBalanceOpen(false);
                else void qc.invalidateQueries({ queryKey: ["tournament", id, "balance-plan"] });
              }}
            >
              <Scale /> {t("Apply moves")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={breakTable !== undefined} onOpenChange={(o) => !o && setBreakTable(undefined)}>
        <DialogContent wide>
          <DialogHeader>
            <DialogTitle>{brk.data?.tableNumber ? t("Break table {n}", { n: brk.data.tableNumber }) : t("Break table")}</DialogTitle>
            <DialogDescription>{t("Players from the breaking table receive random open seats, shortest tables first.")}</DialogDescription>
          </DialogHeader>
          {brk.isLoading && <Spinner />}
          {brk.error && <Alert variant="destructive">{errorMessage(brk.error)}</Alert>}
          {brk.data && !brk.data.tableId && <Alert>{breakReason(brk.data.recommendation.reason, t)}</Alert>}
          {brk.data?.tableId && <MovesList moves={brk.data.moves} />}
          <DialogFooter>
            <Button variant="ghost" size="lg" onClick={() => setBreakTable(undefined)}>
              {t("Cancel")}
            </Button>
            <Button
              size="lg"
              variant="warning"
              disabled={!brk.data?.tableId}
              loading={pending}
              onClick={async () => {
                const res = await run("BREAK_TABLE", { tableId: brk.data!.tableId, moves: brk.data!.moves.map(stripPlan) }, { expectedVersion: brk.data!.basedOnVersion, success: t("Table broken") });
                if (res) setBreakTable(undefined);
                else void qc.invalidateQueries({ queryKey: ["tournament", id, "break-plan"] });
              }}
            >
              <Scissors /> {t("Break table")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDraw}
        onOpenChange={setConfirmDraw}
        title={t("Seat unseated players?")}
        description={t("Each unseated player gets a random open seat (new tables open if needed).")}
        onConfirm={() => run("APPLY_INITIAL_SEATING", { generate: true }, { success: t("Players seated") })}
      />
      <ConfirmDialog
        open={!!closeTable}
        onOpenChange={(o) => !o && setCloseTable(null)}
        title={t("Close table {n}?", { n: closeTable?.tableNumber ?? "" })}
        onConfirm={() => run("CLOSE_TABLE", { tableId: closeTable!.id }, { success: t("Table closed") })}
      />
    </div>
  );
}
