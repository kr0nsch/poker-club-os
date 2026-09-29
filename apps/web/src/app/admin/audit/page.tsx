"use client";

import { Badge, Button, Card, CardContent, EmptyState, Field, Input, Label, PageHeader, Select, Table, TBody, Td, Th, THead, Tr, cn } from "@pcos/ui";
import { COMMAND_TYPES } from "@pcos/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardList, Filter, RefreshCw, RotateCcw } from "lucide-react";
import { Fragment, useState } from "react";
import { lbl, useSysLabels } from "@/components/admin-system/labels";
import { sysKeys, useDevices, useStaffList, useTournamentOptions } from "@/components/admin-system/queries";
import type { AuditRow } from "@/components/admin-system/types";
import { CopyButton, ErrorState, JsonBlock, NoAccess, RowsSkeleton, shortId, useLocaleTag } from "@/components/admin-system/ui";
import { useCan } from "@/components/staff-guard";
import { get, qs } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Filters {
  action: string;
  entityType: string;
  tournamentId: string;
  actorId: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { action: "", entityType: "", tournamentId: "", actorId: "", from: "", to: "" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KNOWN_ACTIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "SETUP_COMPLETED",
  "SETTINGS_UPDATED",
  "VENUE_CREATED",
  "VENUE_UPDATED",
  "STAFF_CREATED",
  "STAFF_UPDATED",
  "DEVICE_UPDATED",
  "DEVICE_REVOKED",
  "DEVICE_RESTORED",
  "DEVICE_DISCONNECTED",
  "DISPLAY_TOKEN_CREATED",
  "DISPLAY_TOKEN_REVOKED",
  "TELEGRAM_INTEGRATION_UPDATED",
  "TELEGRAM_LINKED",
  "TELEGRAM_UNLINKED",
  "SYNC_CONFLICT_RESOLVED",
  "DATA_EXPORTED",
  "IMPORT_APPLIED",
  "TOURNAMENT_CREATED",
  "TOURNAMENT_UPDATED",
  "PLAYER_CREATED",
  "PLAYER_UPDATED",
  "PLAYER_ANONYMIZED",
  "RESULT_CORRECTED",
  "ANNOUNCEMENT_CREATED",
];
const KNOWN_ENTITIES = [
  "announcement",
  "device",
  "display_token",
  "entry",
  "export",
  "import_job",
  "league",
  "organization",
  "organization_settings",
  "player",
  "registration",
  "staff",
  "structure",
  "sync_conflict",
  "telegram_integration",
  "telegram_link",
  "tournament",
  "tournament_command",
  "tournament_result",
  "user",
  "venue",
];

/** Append-only audit log (spec §73): who changed what, when and from which device. */
export default function AuditPage() {
  const t = useT();
  const can = useCan();
  return (
    <div className="grid gap-6">
      <PageHeader className="mb-0" title={t("Audit log")} description={t("Every change made on this edge server: who, when, from which device. Entries can never be edited or deleted.")} />
      {can("audit.read") ? <AuditContent /> : <NoAccess permission="audit.read" />}
    </div>
  );
}

/** datetime-local value → ISO string with offset. */
const toIsoParam = (v: string) => (v ? new Date(v).toISOString() : undefined);

function AuditContent() {
  const t = useT();
  const tag = useLocaleTag();
  const L = useSysLabels();
  const can = useCan();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const staff = useStaffList(can("staff.manage"));
  const devices = useDevices(can("device.manage"));
  const tournaments = useTournamentOptions();

  const params = {
    limit,
    offset,
    action: applied.action.trim() || undefined,
    entityType: applied.entityType.trim() || undefined,
    tournamentId: applied.tournamentId || undefined,
    actorId: applied.actorId.trim() || undefined,
    from: toIsoParam(applied.from),
    to: toIsoParam(applied.to),
  };
  const audit = useQuery({
    queryKey: sysKeys.audit(params),
    queryFn: () => get<AuditRow[]>(`/api/v1/audit${qs(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: offset === 0 ? 30_000 : false,
  });
  const rows = audit.data ?? [];

  const actorError = draft.actorId.trim() && !UUID.test(draft.actorId.trim()) ? t("Enter a user ID (UUID).") : null;
  const rangeError = draft.from && draft.to && draft.from > draft.to ? t("“From” must be before “To”.") : null;
  const apply = () => {
    if (actorError || rangeError) return;
    setApplied(draft);
    setOffset(0);
    setExpanded(new Set());
  };
  const reset = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setOffset(0);
    setExpanded(new Set());
  };
  const active = Object.values(applied).some(Boolean);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deviceName = (id: string | null) => (id ? (devices.data?.find((d) => d.deviceId === id)?.name ?? shortId(id)) : null);
  const tournamentName = (id: string | null) => (id ? (tournaments.data?.find((x) => x.id === id)?.name ?? shortId(id)) : null);
  const actionOptions = [...new Set([...KNOWN_ACTIONS, ...COMMAND_TYPES, ...rows.map((r) => r.action)])].sort();
  const entityOptions = [...new Set([...KNOWN_ENTITIES, ...rows.map((r) => r.entityType)])].sort();
  const time = (iso: string) => new Date(iso).toLocaleString(tag, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <>
      <Card>
        <CardContent className="pt-5">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <Field label={t("Action")}>
              <Input value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value.toUpperCase() })} list="audit-actions" placeholder="DEVICE_REVOKED" className="font-mono" />
              <datalist id="audit-actions">
                {actionOptions.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <Field label={t("Entity type")}>
              <Input value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value.toLowerCase() })} list="audit-entities" placeholder="tournament" className="font-mono" />
              <datalist id="audit-entities">
                {entityOptions.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <Field label={t("Tournament")}>
              <Select value={draft.tournamentId} onChange={(e) => setDraft({ ...draft, tournamentId: e.target.value })}>
                <option value="">{t("All tournaments")}</option>
                {(tournaments.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Actor")} error={actorError}>
              {staff.data ? (
                <Select value={draft.actorId} onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}>
                  <option value="">{t("Everyone")}</option>
                  {staff.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={draft.actorId} onChange={(e) => setDraft({ ...draft, actorId: e.target.value })} placeholder={t("User ID")} className="font-mono" />
              )}
            </Field>
            <Field label={t("From")} error={rangeError}>
              <Input type="datetime-local" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </Field>
            <Field label={t("To")}>
              <Input type="datetime-local" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </Field>
            <Field label={t("Rows per page")}>
              <Select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setOffset(0);
                }}
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" className="flex-1">
                <Filter /> {t("Apply")}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={!active && !Object.values(draft).some(Boolean)}>
                <RotateCcw /> {t("Reset")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {audit.isLoading ? (
        <RowsSkeleton rows={8} />
      ) : audit.error ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title={offset > 0 ? t("No more entries") : t("No entries")} description={active ? t("Nothing matches the filters.") : undefined} />
      ) : (
        <Table className={cn(audit.isPlaceholderData && "opacity-60")}>
          <THead>
            <Tr>
              <Th className="w-8" />
              <Th>{t("Time")}</Th>
              <Th>{t("Actor")}</Th>
              <Th>{t("Device")}</Th>
              <Th>{t("Action")}</Th>
              <Th>{t("Entity")}</Th>
              <Th>{t("Tournament")}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const open = expanded.has(r.id);
              const channel = typeof r.metadata?.channel === "string" ? r.metadata.channel : null;
              return (
                <Fragment key={r.id}>
                  <Tr className={cn("cursor-pointer", open && "bg-muted/40")} onClick={() => toggle(r.id)} aria-expanded={open}>
                    <Td className="pr-0">
                      <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{time(r.createdAt)}</Td>
                    <Td>
                      <div>{r.actorName ?? lbl(L.actorKind, r.actorKind)}</div>
                      {channel && <div className="text-xs text-muted-foreground">{lbl(L.channelOrigin, channel)}</div>}
                    </Td>
                    <Td className="text-sm">{deviceName(r.deviceId) ?? <span className="text-muted-foreground">—</span>}</Td>
                    <Td>
                      <Badge variant="outline" className="font-mono">
                        {r.action}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="font-mono text-xs">{r.entityType}</div>
                      {r.entityId && <div className="font-mono text-xs text-muted-foreground">{shortId(r.entityId)}</div>}
                    </Td>
                    <Td className="max-w-48 truncate text-sm">{tournamentName(r.tournamentId) ?? <span className="text-muted-foreground">—</span>}</Td>
                  </Tr>
                  {open && (
                    <tr className="border-b border-border bg-muted/20">
                      <td colSpan={7} className="p-4">
                        <AuditDetails row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground tabular-nums">
          {rows.length > 0 ? t("Entries {from}–{to}", { from: offset + 1, to: offset + rows.length }) : ""}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void audit.refetch()} loading={audit.isFetching}>
            <RefreshCw /> {t("Refresh")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - limit));
              setExpanded(new Set());
            }}
          >
            <ChevronLeft /> {t("Newer")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length < limit}
            onClick={() => {
              setOffset(offset + limit);
              setExpanded(new Set());
            }}
          >
            {t("Older")} <ChevronRight />
          </Button>
        </div>
      </div>
    </>
  );
}

function AuditDetails({ row }: { row: AuditRow }) {
  const t = useT();
  const blocks: { label: string; value: unknown }[] = [
    { label: t("Before"), value: row.before },
    { label: t("After"), value: row.after },
    { label: t("Metadata"), value: row.metadata },
  ].filter((b) => b.value != null);
  const ids: { label: string; value: string | null }[] = [
    { label: t("Entity ID"), value: row.entityId },
    { label: t("Actor ID"), value: row.actorId },
    { label: t("Device ID"), value: row.deviceId },
    { label: t("Tournament ID"), value: row.tournamentId },
    { label: "IP", value: row.ip },
    { label: t("Edge node"), value: row.edgeNodeId },
  ];
  return (
    <div className="grid gap-4">
      <div className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {ids
          .filter((x) => x.value)
          .map((x) => (
            <div key={x.label} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-muted-foreground">{x.label}:</span>
              <code className="truncate font-mono" title={x.value!}>
                {x.value}
              </code>
              <CopyButton value={x.value!} variant="ghost" className="h-6" />
            </div>
          ))}
      </div>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No change details recorded.")}</p>
      ) : (
        <div className={cn("grid gap-3", blocks.length > 1 && "lg:grid-cols-2", blocks.length > 2 && "xl:grid-cols-3")}>
          {blocks.map((b) => (
            <div key={b.label} className="grid min-w-0 content-start gap-1.5">
              <Label>{b.label}</Label>
              <JsonBlock value={b.value} className="max-h-72" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
