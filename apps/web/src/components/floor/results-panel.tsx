"use client";

import { Alert, Badge, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import type { ResultView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Ban, CheckCircle2, Download, Flag, PencilLine, RotateCcw } from "lucide-react";
import { useState } from "react";
import { get } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { ConfirmDialog, ReasonDialog } from "./dialogs";
import { useFloor } from "./floor-context";

export function ResultsPanel() {
  const t = useT();
  const { id, snapshot, run, pending } = useFloor();
  const status = snapshot.tournament.status;
  const live = ["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"].includes(status);
  const finished = status === "FINISHED" || status === "FINALIZED";
  const remaining = snapshot.entries.filter((e) => e.status === "ACTIVE");
  const [finish, setFinish] = useState<string[] | null>(null);
  const [finalize, setFinalize] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [correct, setCorrect] = useState<ResultView | null>(null);
  const [newPos, setNewPos] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const results = useQuery({
    queryKey: ["tournament", id, "results", snapshot.tournament.version],
    queryFn: () => get<ResultView[]>(`/api/v1/tournaments/${id}/results`),
    enabled: finished,
  });
  const move = (i: number, d: -1 | 1) =>
    setFinish((o) => {
      if (!o) return o;
      const n = [...o];
      const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const name = (entryId: string) => remaining.find((e) => e.id === entryId)?.playerName ?? "?";

  return (
    <div className="grid gap-4">
      {live && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">{t("Finish tournament")}</div>
              <p className="text-sm text-muted-foreground">
                {remaining.length === 1
                  ? t("One player remains — the tournament can be finished.")
                  : t("{n} players remain. Finish with a manual final order only for a deal.", { n: remaining.length })}
              </p>
            </div>
            <Button size="lg" variant={remaining.length === 1 ? "default" : "outline"} onClick={() => setFinish(remaining.map((e) => e.id))} disabled={remaining.length === 0}>
              <Flag /> {t("Finish tournament")}
            </Button>
          </div>
        </Card>
      )}

      {finished && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium">
              {t("Results")} <Badge variant={status === "FINALIZED" ? "success" : "warning"}>{status === "FINALIZED" ? t("Final") : t("Provisional")}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/api/v1/tournaments/${id}/results.csv`}>
                  <Download /> CSV
                </a>
              </Button>
              {status === "FINISHED" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setReopen(true)}>
                    <RotateCcw /> {t("Reopen")}
                  </Button>
                  <Button size="sm" onClick={() => setFinalize(true)}>
                    <CheckCircle2 /> {t("Finalize results")}
                  </Button>
                </>
              )}
            </div>
          </div>
          {results.data && (
            <Table>
              <THead>
                <Tr>
                  <Th>#</Th>
                  <Th>{t("Player")}</Th>
                  <Th>{t("Entries")}</Th>
                  <Th>{t("Points")}</Th>
                  <Th className="text-right">{t("Actions")}</Th>
                </Tr>
              </THead>
              <TBody>
                {results.data.map((r) => (
                  <Tr key={r.playerId}>
                    <Td className="font-semibold tabular-nums">{r.position}</Td>
                    <Td>
                      {r.playerName}
                      {r.revision > 0 && <Badge variant="muted" className="ml-2">rev {r.revision}</Badge>}
                    </Td>
                    <Td className="tabular-nums">{r.entries}</Td>
                    <Td className="tabular-nums">{r.points ?? "—"}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setCorrect(r)}>
                        <PencilLine /> {t("Correct")}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {!["FINALIZED", "CANCELLED", "FINISHED"].includes(status) && (
        <Card className="border-destructive/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-destructive">{t("Cancel tournament")}</div>
              <p className="text-sm text-muted-foreground">{t("Registered players are notified. This cannot be undone.")}</p>
            </div>
            <Button variant="destructive" onClick={() => setCancel(true)}>
              <Ban /> {t("Cancel tournament")}
            </Button>
          </div>
        </Card>
      )}

      <Dialog open={!!finish} onOpenChange={(o) => !o && setFinish(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Finish tournament")}</DialogTitle>
          </DialogHeader>
          {finish && finish.length > 1 && <Alert variant="warning">{t("Several players remain. Set the agreed final order (1st place first).")}</Alert>}
          <div className="grid gap-1.5">
            {finish?.map((entryId, i) => (
              <div key={entryId} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <span className="w-8 font-semibold">{i + 1}.</span>
                <span className="flex-1">{name(entryId)}</span>
                {finish.length > 1 && (
                  <>
                    <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon" variant="ghost" disabled={i === finish.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              size="lg"
              loading={pending}
              onClick={async () => {
                const res = await run("FINISH_TOURNAMENT", finish && finish.length > 1 ? { finalOrder: finish } : {}, { success: t("Tournament finished") });
                if (res) setFinish(null);
              }}
            >
              <Flag /> {t("Finish tournament")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={finalize}
        onOpenChange={setFinalize}
        title={t("Finalize results?")}
        description={t("League points are calculated and players are notified. Later changes require a result correction with a reason.")}
        confirmLabel={t("Finalize results")}
        onConfirm={() => run("FINALIZE_RESULTS", {}, { success: t("Results finalized") })}
      />
      <ReasonDialog open={reopen} onOpenChange={setReopen} title={t("Reopen the tournament?")} description={t("Provisional results are removed and the clock is paused.")} confirmLabel={t("Reopen")} onSubmit={(reason) => run("REOPEN_TOURNAMENT", { reason })} />
      <ReasonDialog open={cancel} onOpenChange={setCancel} title={t("Cancel tournament")} destructive confirmLabel={t("Cancel tournament")} onSubmit={(reason) => run("CANCEL_TOURNAMENT", { reason }, { success: t("Tournament cancelled") })} />
      <Dialog open={!!correct} onOpenChange={(o) => !o && setCorrect(null)}>
        <DialogContent>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await run("CORRECT_RESULT", { playerId: correct!.playerId, position: Number(newPos), reason: corrReason }, { success: t("Result corrected") });
              if (res) {
                setCorrect(null);
                setNewPos("");
                setCorrReason("");
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("Correct result: {name}", { name: correct?.playerName ?? "" })}</DialogTitle>
            </DialogHeader>
            <Field label={t("New position")} hint={t("The player currently holding that position takes the old one.")}>
              <Select value={newPos} onChange={(e) => setNewPos(e.target.value)} required>
                <option value="">—</option>
                {(results.data ?? []).map((r) => (
                  <option key={r.position} value={r.position} disabled={r.position === correct?.position}>
                    {r.position}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Reason")}>
              <Input value={corrReason} onChange={(e) => setCorrReason(e.target.value)} minLength={3} required />
            </Field>
            <DialogFooter>
              <Button type="submit" size="lg" loading={pending}>
                {t("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
