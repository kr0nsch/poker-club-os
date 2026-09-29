"use client";

import { Badge, Button, Card, EmptyState, Spinner } from "@pcos/ui";
import type { OperationalActionView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { History, Undo2 } from "lucide-react";
import { useState } from "react";
import { get } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { keys } from "@/lib/queries";
import { ReasonDialog } from "./dialogs";
import { useFloor } from "./floor-context";

/** Operational history with undo through compensating actions (spec §63). */
export function ActionsLog({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const fmt = useFormat();
  const { id, snapshot, run } = useFloor();
  const [undo, setUndo] = useState<OperationalActionView | null>(null);
  const actions = useQuery({
    queryKey: [...keys.actions(id), snapshot.tournament.version],
    queryFn: () => get<OperationalActionView[]>(`/api/v1/tournaments/${id}/actions?limit=${compact ? 8 : 100}`),
    placeholderData: (prev) => prev,
  });
  const list = actions.data ?? [];
  const Wrapper = compact ? "div" : Card;
  return (
    <Wrapper className={compact ? "grid gap-1.5" : "p-4"}>
      {!compact && <div className="mb-3 text-sm font-medium">{t("Recent actions")}</div>}
      {actions.isLoading && <Spinner />}
      {!actions.isLoading && list.length === 0 && <EmptyState icon={<History />} title={t("No actions yet")} />}
      <div className="grid gap-1.5">
        {list.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{fmt.time(a.createdAt)}</span>
            <div className="min-w-0 flex-1">
              <div className={a.compensatedByActionId ? "truncate text-muted-foreground line-through" : "truncate"}>{a.summary}</div>
              {!compact && (
                <div className="text-xs text-muted-foreground">
                  {a.actorName ?? t("system")}
                  {a.deviceName && ` · ${a.deviceName}`} · v{a.resultVersion}
                </div>
              )}
            </div>
            {a.compensatesActionId && <Badge variant="muted">{t("undo")}</Badge>}
            {a.undoable && (
              <Button size="sm" variant="outline" onClick={() => setUndo(a)}>
                <Undo2 /> {t("Undo")}
              </Button>
            )}
          </div>
        ))}
      </div>
      <ReasonDialog
        open={!!undo}
        onOpenChange={(o) => !o && setUndo(null)}
        title={t("Undo: {summary}", { summary: undo?.summary ?? "" })}
        description={t("A compensating action is recorded; history is never deleted.")}
        confirmLabel={t("Undo")}
        onSubmit={(reason) => run("UNDO_ACTION", { actionId: undo!.id, reason }, { success: t("Action undone") })}
      />
    </Wrapper>
  );
}
