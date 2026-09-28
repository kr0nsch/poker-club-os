// Background loops of the edge worker process: clock ticker, WAN monitor,
// Telegram long polling, outbox fan-out, notification delivery, cloud sync,
// reminders, backups and housekeeping. None of them is on the critical path
// of a live tournament command.

import type { Core } from "../app.js";

export interface WorkerHandle {
  stop(): Promise<void>;
  runners: ReturnType<Core["createRunners"]>;
}

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[worker] ${name} failed:`, e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  };
  const t = setInterval(run, ms);
  void run();
  return () => clearInterval(t);
}

export async function startWorkerLoops(core: Core): Promise<WorkerHandle> {
  const r = core.createRunners();
  await r.dispatcher.recoverStale();
  r.wan.start();
  r.clock.start();
  r.telegramPolling.start();

  const stops = [
    every(1_000, "fanout", async () => {
      // Drain the outbox quickly after bursts (e.g. seat draw of 200 players).
      for (let i = 0; i < 20 && (await r.fanout.runOnce()) > 0; i++);
    }),
    every(2_000, "dispatch", () => r.dispatcher.runOnce()),
    every(10_000, "cloud-push", async () => {
      if (core.sync.enabled && r.wan.isOnline()) await core.sync.pushOnce();
    }),
    every(60_000, "cloud-pull", async () => {
      if (core.sync.enabled && r.wan.isOnline()) await core.sync.pullOnce();
    }),
    every(60_000, "reminders", () => r.scheduler.reminders()),
    every(60_000, "backups", () => core.backups.runDue()),
    every(30_000, "heartbeat", () => core.edge.ensureNode()),
    every(6 * 3600_000, "housekeeping", () => r.scheduler.housekeeping()),
  ];

  return {
    runners: r,
    async stop() {
      stops.forEach((s) => s());
      r.clock.stop();
      r.wan.stop();
      await r.telegramPolling.stop();
    },
  };
}
