"use client";

import type { CommandResult, CommandType, EntryView, RegistrationView, TableView, TournamentSnapshot } from "@pcos/types";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { useCommand } from "@/lib/queries";

export interface RunOptions {
  expectedVersion?: number;
  success?: string;
  clientOperationId?: string;
  silent?: boolean;
}

interface FloorCtx {
  id: string;
  snapshot: TournamentSnapshot;
  run: <T = unknown>(type: CommandType, payload?: Record<string, unknown>, opts?: RunOptions) => Promise<(CommandResult & { result: T }) | null>;
  pending: boolean;
  entries: Map<string, EntryView>;
  tables: Map<string, TableView>;
  registrations: Map<string, RegistrationView>;
}

const Ctx = createContext<FloorCtx | null>(null);

export function FloorProvider({ snapshot, children }: { snapshot: TournamentSnapshot; children: ReactNode }) {
  const id = snapshot.tournament.id;
  const command = useCommand(id);
  const run = useCallback(
    async <T,>(type: CommandType, payload: Record<string, unknown> = {}, opts: RunOptions = {}) => {
      try {
        const res = await command.mutateAsync({ type, payload, expectedVersion: opts.expectedVersion, clientOperationId: opts.clientOperationId, silent: opts.silent });
        if (opts.success) toast.success(opts.success);
        return res as CommandResult & { result: T };
      } catch {
        return null; // feedback already shown by useCommand
      }
    },
    [command],
  );
  const value = useMemo<FloorCtx>(
    () => ({
      id,
      snapshot,
      run,
      pending: command.isPending,
      entries: new Map(snapshot.entries.map((e) => [e.id, e])),
      tables: new Map(snapshot.tables.map((t) => [t.id, t])),
      registrations: new Map(snapshot.registrations.map((r) => [r.id, r])),
    }),
    [id, snapshot, run, command.isPending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFloor() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFloor outside FloorProvider");
  return ctx;
}
