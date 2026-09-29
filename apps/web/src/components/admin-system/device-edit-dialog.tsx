"use client";

import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, Spinner } from "@pcos/ui";
import { DEVICE_TYPES, type DeviceType, type TournamentSnapshot, type TournamentSummaryView } from "@pcos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { get, patch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage, keys } from "@/lib/queries";
import { useSysLabels } from "./labels";
import { sysKeys } from "./queries";
import type { DeviceRow } from "./types";

/** Rename a device, change its type and assign a dealer tablet to a table. */
export function DeviceEditDialog({
  device,
  liveTournaments,
  initialTournamentId,
  onClose,
}: {
  device: DeviceRow;
  liveTournaments: TournamentSummaryView[];
  /** tournament owning the currently assigned table, when known */
  initialTournamentId: string | null;
  onClose(): void;
}) {
  const t = useT();
  const L = useSysLabels();
  const qc = useQueryClient();
  const [name, setName] = useState(device.name);
  const [type, setType] = useState<DeviceType>(device.type);
  const [tournamentId, setTournamentId] = useState(initialTournamentId ?? "");
  const [tableId, setTableId] = useState(device.assignedTableId ?? "");

  // Same cache entry as the floor surfaces' tournament snapshot.
  const snapshot = useQuery({
    queryKey: keys.snapshot(tournamentId || "none"),
    queryFn: () => get<TournamentSnapshot>(`/api/v1/tournaments/${tournamentId}/snapshot`),
    enabled: !!tournamentId,
  });
  const tables = (snapshot.data?.tables ?? []).filter((x) => x.status !== "CLOSED" || x.id === tableId).sort((a, b) => a.tableNumber - b.tableNumber);
  const unknownAssignment = !tournamentId && !!tableId;

  const body = () => {
    const out: { name?: string; type?: DeviceType; assignedTableId?: string | null } = {};
    if (name.trim() !== device.name) out.name = name.trim();
    if (type !== device.type) out.type = type;
    const nextTable = tableId || null;
    if (nextTable !== device.assignedTableId) out.assignedTableId = nextTable;
    return out;
  };
  const changes = body();
  const dirty = Object.keys(changes).length > 0;
  // A chosen tournament needs a table; "No table assigned" clears the assignment.
  const valid = name.trim().length > 0 && name.trim().length <= 80 && (!tournamentId || !!tableId);

  const save = useMutation({
    mutationFn: () => patch<DeviceRow>(`/api/v1/devices/${device.id}`, changes),
    onSuccess: () => {
      toast.success(t("Device saved"));
      void qc.invalidateQueries({ queryKey: sysKeys.devices });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Edit device")}</DialogTitle>
          <DialogDescription>
            <code className="font-mono text-xs">{device.deviceId}</code>
          </DialogDescription>
        </DialogHeader>
        <form
          id="device-edit-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && dirty) save.mutate();
          }}
        >
          <Field label={t("Name")} hint={t("A name staff recognise, e.g. “TD tablet 1” or “Dealer table 4”.")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          </Field>
          <Field label={t("Type")}>
            <Select value={type} onChange={(e) => setType(e.target.value as DeviceType)}>
              {DEVICE_TYPES.map((d) => (
                <option key={d} value={d}>
                  {L.deviceType[d]}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="grid gap-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t("Dealer table")}</legend>
            <p className="text-xs text-muted-foreground">{t("A dealer tablet assigned to a table opens that table directly in the dealer interface.")}</p>
            {type !== "DEALER_TABLET" && (tournamentId || tableId) && <Alert variant="warning">{t("Table assignment is only used by dealer tablets.")}</Alert>}
            <Field label={t("Tournament")}>
              <Select
                value={tournamentId}
                onChange={(e) => {
                  setTournamentId(e.target.value);
                  setTableId("");
                }}
              >
                <option value="">{t("No table assigned")}</option>
                {liveTournaments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {t(x.status)}
                  </option>
                ))}
              </Select>
            </Field>
            {tournamentId && (
              <Field label={t("Table")}>
                {snapshot.isLoading ? (
                  <Spinner label={t("Loading tables…")} />
                ) : snapshot.error ? (
                  <p className="text-sm text-destructive">{errorMessage(snapshot.error)}</p>
                ) : tables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("This tournament has no tables yet.")}</p>
                ) : (
                  <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
                    <option value="">{t("Choose a table")}</option>
                    {tables.map((x) => (
                      <option key={x.id} value={x.id}>
                        {t("Table {n}", { n: x.tableNumber })} · {t("{occupied}/{capacity} seated", { occupied: x.occupied, capacity: x.capacity })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {unknownAssignment && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{t("Assigned to a table of a tournament that is no longer running.")}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => setTableId("")}>
                  {t("Remove assignment")}
                </Button>
              </div>
            )}
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" form="device-edit-form" disabled={!valid || !dirty} loading={save.isPending}>
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
