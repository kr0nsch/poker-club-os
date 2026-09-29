"use client";

import { Badge, Button, Card, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import type { EntryView } from "@pcos/types";
import { ArrowDown, ArrowUp, RotateCcw, Search, Skull, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFormat, useT } from "@/lib/i18n";
import { useFloor } from "./floor-context";
import { ReasonDialog } from "./dialogs";

export function EntriesView() {
  const t = useT();
  const fmt = useFormat();
  const { snapshot, run, pending } = useFloor();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bustOrder, setBustOrder] = useState<string[] | null>(null);
  const [restore, setRestore] = useState<EntryView | null>(null);
  const [voidEntry, setVoidEntry] = useState<EntryView | null>(null);
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  const needle = q.trim().toLowerCase();
  const match = (e: EntryView) => !needle || e.playerName.toLowerCase().includes(needle);
  const active = snapshot.entries
    .filter((e) => e.status === "ACTIVE" && match(e))
    .sort((a, b) => (a.tableNumber ?? 999) - (b.tableNumber ?? 999) || (a.seatNumber ?? 0) - (b.seatNumber ?? 0));
  const eliminated = snapshot.entries.filter((e) => e.status === "ELIMINATED" && match(e)).sort((a, b) => (b.eliminatedAt ?? "").localeCompare(a.eliminatedAt ?? ""));
  const byId = new Map(snapshot.entries.map((e) => [e.id, e]));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const move = (i: number, d: -1 | 1) =>
    setBustOrder((o) => {
      if (!o) return o;
      const n = [...o];
      const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[min(16rem,100%)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search")} className="pl-9" />
        </div>
        <Button size="lg" variant="destructive" disabled={selected.length === 0} onClick={() => setBustOrder(selected)}>
          <Skull /> {selected.length > 1 ? t("Eliminate {n} (same hand)", { n: selected.length }) : t("Eliminate")}
        </Button>
      </div>

      <Card>
        <Table>
          <THead>
            <Tr>
              <Th className="w-10" />
              <Th>{t("Player")}</Th>
              <Th>{t("Table")}</Th>
              <Th className="text-right">{t("Chips")}</Th>
              <Th>{t("Entry")}</Th>
            </Tr>
          </THead>
          <TBody>
            {active.map((e) => (
              <Tr key={e.id} className={selected.includes(e.id) ? "bg-destructive/10" : undefined}>
                <Td>
                  <Checkbox checked={selected.includes(e.id)} onChange={() => toggle(e.id)} aria-label={e.playerName} />
                </Td>
                <Td className="font-medium">{e.playerName}</Td>
                <Td className="tabular-nums">{e.tableNumber ? `${e.tableNumber} / ${e.seatNumber}` : <Badge variant="warning">{t("Unseated")}</Badge>}</Td>
                <Td className="text-right tabular-nums">{fmt.number(e.chips)}</Td>
                <Td className="text-xs text-muted-foreground">
                  #{e.entryNumber}
                  {e.type === "REENTRY" && ` · ${t("Re-entry")}`}
                  {e.rebuys ? ` · R${e.rebuys}` : ""}
                  {e.addons ? ` · A${e.addons}` : ""}
                </Td>
              </Tr>
            ))}
            {active.length === 0 && (
              <Tr>
                <Td colSpan={5} className="text-center text-muted-foreground">
                  {t("No active players")}
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
      </Card>

      {eliminated.length > 0 && (
        <Card>
          <div className="px-4 pt-3 text-sm font-medium">{t("Eliminated")}</div>
          <Table className="mt-2">
            <THead>
              <Tr>
                <Th>{t("Place")}</Th>
                <Th>{t("Player")}</Th>
                {/* Phones keep place, player and actions; time and knockout credit return from sm. */}
                <Th className="max-sm:hidden">{t("Time")}</Th>
                <Th className="max-sm:hidden">{t("Eliminated by")}</Th>
                <Th className="text-right">{t("Actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {eliminated.map((e) => (
                <Tr key={e.id}>
                  <Td className="tabular-nums">{e.finishPosition ?? "—"}</Td>
                  <Td>
                    {e.playerName} <span className="text-xs text-muted-foreground">#{e.entryNumber}</span>
                  </Td>
                  <Td className="text-xs text-muted-foreground max-sm:hidden">{fmt.time(e.eliminatedAt)}</Td>
                  <Td className="text-xs text-muted-foreground max-sm:hidden">{e.eliminatedByEntryId ? byId.get(e.eliminatedByEntryId)?.playerName : "—"}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="outline" onClick={() => setRestore(e)} title={t("Restore")}>
                      <RotateCcw /> <span className="max-sm:sr-only">{t("Restore")}</span>
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setVoidEntry(e)} title={t("Void entry")}>
                      <Trash2 />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Dialog
        open={!!bustOrder}
        onOpenChange={(o) => {
          if (!o) setBustOrder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Confirm elimination")}</DialogTitle>
            {bustOrder && bustOrder.length > 1 && (
              <DialogDescription>{t("Order by stack at the start of the hand — largest first. The larger stack finishes higher (TDA).")}</DialogDescription>
            )}
          </DialogHeader>
          <div className="grid gap-1.5">
            {bustOrder?.map((id, i) => (
              <div key={id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <span className="w-6 text-muted-foreground">{i + 1}.</span>
                <span className="flex-1 font-medium">{byId.get(id)?.playerName}</span>
                {bustOrder.length > 1 && (
                  <>
                    <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">
                      <ArrowUp />
                    </Button>
                    <Button size="icon" variant="ghost" disabled={i === bustOrder.length - 1} onClick={() => move(i, 1)} aria-label="down">
                      <ArrowDown />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="lg" onClick={() => setBustOrder(null)}>
              {t("Cancel")}
            </Button>
            <Button
              size="xl"
              variant="destructive"
              loading={pending}
              onClick={async () => {
                const res = await run("ELIMINATE_PLAYERS", { entryIds: bustOrder }, { clientOperationId: opId, success: t("Elimination recorded") });
                if (res) {
                  setBustOrder(null);
                  setSelected([]);
                  setOpId(crypto.randomUUID());
                }
              }}
            >
              <Skull /> {t("Eliminate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={!!restore}
        onOpenChange={(o) => !o && setRestore(null)}
        title={t("Restore {name}?", { name: restore?.playerName ?? "" })}
        description={t("The player returns to the original seat if it is still free.")}
        confirmLabel={t("Restore")}
        onSubmit={(reason) => run("RESTORE_PLAYER", { entryId: restore!.id, reason }, { success: t("Player restored") })}
      />
      <ReasonDialog
        open={!!voidEntry}
        onOpenChange={(o) => !o && setVoidEntry(null)}
        title={t("Void entry of {name}?", { name: voidEntry?.playerName ?? "" })}
        description={t("The entry and its transactions are voided (kept in history).")}
        confirmLabel={t("Void entry")}
        destructive
        onSubmit={(reason) => run("VOID_ENTRY", { entryId: voidEntry!.id, reason }, { success: t("Entry voided") })}
      />
    </div>
  );
}
