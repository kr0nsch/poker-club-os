// Materialises automatic level changes (spec §51). Clients already derive the
// countdown locally from the anchor; the ticker persists the new level so that
// status (RUNNING/BREAK), notifications and late-registration rules follow it,
// and broadcasts clock.updated to every LAN device.

import { structureLevels, tournamentClockStates, tournaments } from "@pcos/db";
import { materialize } from "@pcos/domain";
import { asc, eq, inArray } from "drizzle-orm";
import type { CoreDeps } from "../deps.js";
import type { TournamentCommandExecutor } from "../tournaments/executor.js";
import { anchorFromRow } from "../tournaments/repo.js";

export class ClockTicker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly deps: CoreDeps,
    private readonly executor: TournamentCommandExecutor,
    private readonly intervalMs = 500,
  ) {}

  /** One pass; returns the number of tournaments that advanced. */
  async tick(): Promise<number> {
    const rows = await this.deps.db
      .select({ clock: tournamentClockStates, structureId: tournaments.structureId })
      .from(tournamentClockStates)
      .innerJoin(tournaments, eq(tournaments.id, tournamentClockStates.tournamentId))
      .where(eq(tournamentClockStates.clockStatus, "RUNNING"));
    if (rows.length === 0) return 0;
    const structureIds = [...new Set(rows.map((r) => r.structureId))];
    const levels = await this.deps.db
      .select({ structureId: structureLevels.structureId, type: structureLevels.type, durationSeconds: structureLevels.durationSeconds, position: structureLevels.position })
      .from(structureLevels)
      .where(inArray(structureLevels.structureId, structureIds))
      .orderBy(asc(structureLevels.position));
    const now = this.deps.now().getTime();
    let advanced = 0;
    for (const r of rows) {
      const lv = levels.filter((l) => l.structureId === r.structureId).map((l) => ({ type: l.type as "PLAY" | "BREAK", durationSeconds: l.durationSeconds }));
      const anchor = anchorFromRow(r.clock);
      if (materialize(anchor, lv, now) !== anchor) {
        try {
          if (await this.executor.autoAdvance(r.clock.tournamentId)) advanced++;
        } catch (e) {
          console.error(`[clock] auto-advance failed for ${r.clock.tournamentId}:`, e instanceof Error ? e.message : e);
        }
      }
    }
    return advanced;
  }

  start() {
    if (this.timer) return;
    const loop = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tick();
      } catch (e) {
        console.error("[clock] tick failed:", e instanceof Error ? e.message : e);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(loop, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
