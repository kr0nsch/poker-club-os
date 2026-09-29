"use client";

import { Badge, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, cn } from "@pcos/ui";
import { ChevronLeft, ChevronRight, Hand, Lock, LockOpen, Minus, Pause, Play, Plus, Rocket, Shuffle, Timer } from "lucide-react";
import { useState } from "react";
import { anteLabel, blindsLabel, lateRegistrationOpen, useDerivedClock } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";
import { formatClock } from "@pcos/domain";
import { useFloor } from "./floor-context";
import { ConfirmDialog } from "./dialogs";

export function ClockPanel() {
  const t = useT();
  const fmt = useFormat();
  const { snapshot, run, pending } = useFloor();
  const { tournament, clock, levels, stats } = snapshot;
  const d = useDerivedClock(clock, levels);
  const [confirm, setConfirm] = useState<null | "start" | "seating">(null);
  const [setTime, setSetTime] = useState(false);
  const [minutes, setMinutes] = useState("");
  const status = tournament.status;
  const live = ["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"].includes(status);
  const level = d?.level ? levels[d.levelIndex] : undefined;
  const next = d?.nextLevelIndex != null ? levels[d.nextLevelIndex] : undefined;
  const lowTime = d && d.status === "RUNNING" && d.remainingMs < 60_000;
  const fromLevelIndex = d?.levelIndex;
  const n = (v: number) => fmt.number(v);
  const lateRegOpen = lateRegistrationOpen(tournament, d);

  return (
    <Card className={cn("@container overflow-hidden", status === "PAUSED" && "border-warning/60", status === "HAND_FOR_HAND" && "border-destructive/60")}>
      {/* Container queries: a row (figures | controls) when the panel is wide, a column in the floor sidebar. */}
      <div className="grid gap-4 p-4 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {d?.isBreak ? (
              <Badge variant="warning">{t("Break")}</Badge>
            ) : (
              <span className="text-sm font-semibold text-gold">
                {t("Level")} {d?.playLevelNumber ?? 1}
              </span>
            )}
            {status === "PAUSED" && <Badge variant="warning">{t("Clock paused")}</Badge>}
            {status === "HAND_FOR_HAND" && <Badge variant="destructive">{t("Hand-for-hand")}</Badge>}
            {live && (lateRegOpen ? <Badge variant="outline">{t("Late registration open")}</Badge> : <Badge variant="muted">{t("Late registration closed")}</Badge>)}
          </div>
          <div className={cn("clock-digits mt-2 text-7xl font-semibold leading-none @md:text-8xl", lowTime && "text-warning", status === "PAUSED" && "text-warning/70")}>
            {d?.formatted ?? "--:--"}
          </div>
          {d && d.levelDurationMs > 0 && (
            <div className="mt-3 h-1 max-w-md overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full w-full origin-left transition-transform duration-1000 ease-linear", status === "PAUSED" ? "bg-warning" : d.isBreak ? "bg-gold/70" : "bg-gold")}
                style={{ transform: `scaleX(${Math.min(1, d.elapsedMs / d.levelDurationMs)})` }}
              />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {level && level.type === "PLAY" && (
              <span className="text-2xl font-semibold tabular-nums">
                {blindsLabel(level, n)}
                {anteLabel(level, n) && (
                  <span className="ml-2 text-base font-normal text-muted-foreground">
                    {level.anteType === "BIG_BLIND" ? t("BB ante") : t("Ante")} {anteLabel(level, n)}
                  </span>
                )}
              </span>
            )}
            {next && (
              <span className="text-sm text-muted-foreground">
                {t("Next level")}: {next.type === "BREAK" ? t("Break") : blindsLabel(next, n)}
              </span>
            )}
            {d?.msUntilNextBreak != null && !d.isBreak && (
              <span className="text-sm text-muted-foreground">
                {t("Break in")} {formatClock(d.msUntilNextBreak)}
              </span>
            )}
          </div>
        </div>
        <div className="grid content-start gap-2 @3xl:w-72">
          {status === "DRAFT" && (
            <Button size="xl" loading={pending} onClick={() => run("PUBLISH", {}, { success: t("Tournament published") })}>
              {t("Publish")}
            </Button>
          )}
          {status === "SCHEDULED" && (
            <Button size="xl" loading={pending} onClick={() => run("OPEN_REGISTRATION", {}, { success: t("Registration opened") })}>
              {t("Open registration")}
            </Button>
          )}
          {status === "REGISTRATION_OPEN" && (
            <Button size="xl" variant="secondary" onClick={() => setConfirm("seating")}>
              <Shuffle /> {t("Seat draw")}
            </Button>
          )}
          {(status === "REGISTRATION_OPEN" || status === "SEATING") && (
            <Button size="xl" onClick={() => setConfirm("start")}>
              <Rocket /> {t("Start tournament")}
            </Button>
          )}
          {live && (
            <>
              {status === "PAUSED" ? (
                <Button size="xl" variant="success" loading={pending} onClick={() => run("RESUME_CLOCK")}>
                  <Play /> {t("Resume clock")}
                </Button>
              ) : (
                <Button size="xl" loading={pending} onClick={() => run("PAUSE_CLOCK")}>
                  <Pause /> {t("Pause clock")}
                </Button>
              )}
              <div className="grid grid-cols-4 gap-2">
                <Button size="lg" variant="outline" title={t("Previous level")} disabled={pending || (d?.levelIndex ?? 0) === 0} onClick={() => run("PREVIOUS_LEVEL", { fromLevelIndex })}>
                  <ChevronLeft />
                </Button>
                <Button size="lg" variant="outline" title={t("Remove one minute")} disabled={pending} onClick={() => run("ADJUST_CLOCK", { deltaSeconds: -60, fromLevelIndex })}>
                  <Minus />
                </Button>
                <Button size="lg" variant="outline" title={t("Add one minute")} disabled={pending} onClick={() => run("ADJUST_CLOCK", { deltaSeconds: 60, fromLevelIndex })}>
                  <Plus />
                </Button>
                <Button size="lg" variant="outline" title={t("Next level")} disabled={pending || d?.nextLevelIndex == null} onClick={() => run("NEXT_LEVEL", { fromLevelIndex })}>
                  <ChevronRight />
                </Button>
              </div>
              {/* Labels wrap inside the half-width buttons; while hand-for-hand runs, ending it takes the full row on top. */}
              <div className="grid grid-cols-2 gap-2 [&>button]:h-auto [&>button]:min-h-10 [&>button]:whitespace-normal [&>button]:px-2 [&>button]:py-1.5 [&>button]:leading-tight">
                <Button variant="outline" onClick={() => setSetTime(true)}>
                  <Timer /> {t("Set time")}
                </Button>
                {status === "HAND_FOR_HAND" || tournament.pausedFromStatus === "HAND_FOR_HAND" ? (
                  <Button variant="destructive" className="order-first col-span-2" loading={pending} onClick={() => run("END_HAND_FOR_HAND")}>
                    <Hand /> {t("End hand-for-hand")}
                  </Button>
                ) : (
                  <Button variant="outline" disabled={status !== "RUNNING"} loading={pending} onClick={() => run("START_HAND_FOR_HAND")}>
                    <Hand /> {t("Hand-for-hand")}
                  </Button>
                )}
              </div>
              {tournament.lateRegistrationClosed ? (
                <Button variant="ghost" size="sm" onClick={() => run("REOPEN_LATE_REGISTRATION")}>
                  <LockOpen /> {t("Reopen late registration")}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => run("CLOSE_LATE_REGISTRATION", {}, { success: t("Late registration closed") })}>
                  <Lock /> {t("Close late registration")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-px border-t border-border bg-border text-center @3xl:grid-cols-6">
        {[
          [t("Registered"), fmt.number(stats.registrations)],
          [t("Entries"), fmt.number(stats.entries)],
          [t("Remaining"), fmt.number(stats.remaining)],
          [t("Average stack"), stats.averageStack != null ? fmt.number(stats.averageStack) : "—"],
          [t("Re-entries"), `${stats.reentries}${stats.rebuys ? ` · R ${stats.rebuys}` : ""}${stats.addons ? ` · A ${stats.addons}` : ""}`],
          [t("Prize pool"), stats.prizePool != null ? fmt.money(stats.prizePool, tournament.buyIn?.currency) : fmt.number(stats.totalChips)],
        ].map(([label, value], i) => (
          <div key={i} className="bg-card px-2 py-2.5">
            <div className="eyebrow">{i === 5 && stats.prizePool == null ? t("Total chips") : label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirm === "start"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("Start tournament?")}
        description={t("The clock starts at level 1. Checked-in players without a seat are seated by random draw.")}
        confirmLabel={t("Start tournament")}
        onConfirm={() => run("START_TOURNAMENT", {}, { success: t("Tournament started") })}
      />
      <ConfirmDialog
        open={confirm === "seating"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("Draw seats now?")}
        description={t("Every checked-in player receives a random seat; tables are opened as needed. Late arrivals are seated automatically.")}
        confirmLabel={t("Seat draw")}
        onConfirm={() => run("START_SEATING", { draw: true }, { success: t("Seats drawn") })}
      />
      <Dialog open={setTime} onOpenChange={setSetTime}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const [mm, ss] = minutes.split(":");
              const seconds = Math.round(Number(mm || 0) * 60 + Number(ss || 0));
              if (!Number.isFinite(seconds) || seconds < 0) return;
              const res = await run("SET_REMAINING", { remainingSeconds: seconds, fromLevelIndex });
              if (res) setSetTime(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("Set remaining time")}</DialogTitle>
            </DialogHeader>
            <Field label={t("Remaining (mm:ss)")}>
              <Input autoFocus inputMode="numeric" placeholder="12:30" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="text-2xl" />
            </Field>
            <DialogFooter>
              <Button type="submit" size="lg" loading={pending}>
                {t("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
