"use client";

import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Stat,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pcos/ui";
import type { OperationalActionView, ResultView, TournamentDetailView, TournamentSnapshot } from "@pcos/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, ExternalLink, EyeOff, History, MoreHorizontal, QrCode, Send, Tablet, Trophy, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CONFIG_FIELD_LABEL, FORMAT_LABEL, GAME_TYPE_LABEL, TOURNAMENT_STATUS_LABEL, VISIBILITY_LABEL } from "@/components/admin-config/labels";
import { QrCodesDialog } from "@/components/admin-config/qr-dialog";
import { cfgKeys, useOrganization, useStructure, useVenues } from "@/components/admin-config/queries";
import { TournamentConfigFields } from "@/components/admin-config/tournament-config-fields";
import {
  FIELDS,
  buildPayload,
  editableFields,
  formFromDetail,
  isClosedStatus,
  isStartedStatus,
  mergeForms,
  type ConfigField,
  type FormErrors,
  type TournamentForm,
} from "@/components/admin-config/tournament-form";
import { BackLink, ConfirmDialog, QueryError, SaveBar, TableSkeleton, scrollToFirstInvalid, useUnsavedChangesWarning } from "@/components/admin-config/ui";
import { formatDuration, pick, stableStringify, threeWay } from "@/components/admin-config/utils";
import { useCan, useStaff } from "@/components/staff-guard";
import { StatusBadge } from "@/components/status";
import { ApiError, get, patch } from "@/lib/api";
import { blindsLabel, useDerivedClock } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage, keys, useCommand, useTournamentSnapshot } from "@/lib/queries";

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const snap = useTournamentSnapshot(id);
  const org = useOrganization();
  const [tab, setTab] = useState("config");

  if (snap.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!snap.data) {
    const notFound = snap.error instanceof ApiError && snap.error.status === 404;
    return (
      <div>
        <BackLink href="/admin/tournaments" label={t("Tournaments")} />
        {notFound ? (
          <EmptyState icon={<Trophy />} title={t("Tournament not found")} description={t("It may have been removed or belongs to another organization.")} />
        ) : (
          <QueryError error={snap.error} onRetry={() => void snap.refetch()} />
        )}
      </div>
    );
  }

  const s = snap.data;
  const finished = s.tournament.status === "FINISHED" || s.tournament.status === "FINALIZED";
  return (
    <div>
      <BackLink href="/admin/tournaments" label={t("Tournaments")} />
      <TournamentHeader s={s} />
      <StatsRow s={s} />
      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="config">{t("Configuration")}</TabsTrigger>
          {finished && <TabsTrigger value="results">{t("Results")}</TabsTrigger>}
          <TabsTrigger value="history">
            <History className="size-4" /> {t("History")}
          </TabsTrigger>
        </TabsList>
        {/* Kept mounted so unsaved edits survive switching tabs. */}
        <TabsContent value="config" forceMount className="data-[state=inactive]:hidden">
          {org.data || org.isError ? <ConfigTab s={s} currency={org.data?.settings.currency ?? "EUR"} /> : <Skeleton className="h-96" />}
        </TabsContent>
        {finished && (
          <TabsContent value="results">
            <ResultsTab s={s} />
          </TabsContent>
        )}
        <TabsContent value="history">
          <HistoryTab id={s.tournament.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- header & lifecycle ---------------------------------------------------------------------------

function TournamentHeader({ s }: { s: TournamentSnapshot }) {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const me = useStaff();
  const venues = useVenues();
  const tt = s.tournament;
  const cmd = useCommand(tt.id);
  const [qrOpen, setQrOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const closed = isClosedStatus(tt.status);
  const venue = venues.data?.find((v) => v.id === tt.venueId)?.name;
  const pending = (type: string) => cmd.isPending && cmd.variables?.type === type;

  const run = (type: "PUBLISH" | "UNPUBLISH" | "OPEN_REGISTRATION", message: string) => cmd.mutate({ type }, { onSuccess: () => toast.success(message) });

  const facts = [
    fmt.dateTime(tt.startAt),
    venue,
    `${t(FORMAT_LABEL[tt.format])} · ${t(GAME_TYPE_LABEL[tt.gameType])}`,
    tt.buyIn ? `${fmt.money(tt.buyIn.amount, tt.buyIn.currency)}${tt.buyIn.fee ? ` + ${fmt.money(tt.buyIn.fee, tt.buyIn.currency)}` : ""}` : t("Free"),
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {tt.name}
            <StatusBadge status={tt.status} />
            {tt.publicVisibility !== "PUBLIC" && <Badge variant="outline">{t(VISIBILITY_LABEL[tt.publicVisibility])}</Badge>}
          </span>
        }
        description={facts.join(" · ")}
        actions={
          <>
            {tt.status === "DRAFT" && can("tournament.publish") && (
              <Button onClick={() => run("PUBLISH", t("Tournament published"))} loading={pending("PUBLISH")}>
                <Send /> {t("Publish")}
              </Button>
            )}
            {tt.status === "SCHEDULED" && can("tournament.publish") && (
              <Button onClick={() => run("OPEN_REGISTRATION", t("Registration opened"))} loading={pending("OPEN_REGISTRATION")}>
                <UserPlus /> {t("Open registration")}
              </Button>
            )}
            <Button asChild variant={tt.status === "DRAFT" || tt.status === "SCHEDULED" ? "outline" : "default"}>
              <Link href={`/floor/${tt.id}`}>
                <Tablet /> {t("Open floor control")}
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setQrOpen(true)}>
              <QrCode /> <span className="hidden sm:inline">{t("QR codes")}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("More actions")}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {can("results.read") && (
                  <DropdownMenuItem asChild>
                    <a href={`/api/v1/tournaments/${tt.id}/results.csv`} download>
                      <Download /> {t("Download results (CSV)")}
                    </a>
                  </DropdownMenuItem>
                )}
                {tt.published && tt.publicVisibility !== "PRIVATE" && me.organization && (
                  <DropdownMenuItem asChild>
                    <a href={`/p/${me.organization.slug}/live/${tt.slug}`} target="_blank" rel="noreferrer">
                      <ExternalLink /> {t("Public live page")}
                    </a>
                  </DropdownMenuItem>
                )}
                {tt.status === "SCHEDULED" && can("tournament.publish") && (
                  <DropdownMenuItem onSelect={() => run("UNPUBLISH", t("Tournament unpublished"))}>
                    <EyeOff /> {t("Unpublish (back to draft)")}
                  </DropdownMenuItem>
                )}
                {!closed && can("tournament.cancel") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setCancelOpen(true)}>
                      <Ban /> {t("Cancel tournament…")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <QrCodesDialog tournamentId={tt.id} slug={tt.slug} open={qrOpen} onOpenChange={setQrOpen} />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => {
          setCancelOpen(o);
          if (!o) setReason("");
        }}
        title={t("Cancel “{name}”?", { name: tt.name })}
        description={t("Registered players are notified. A cancelled tournament cannot be reopened.")}
        confirmLabel={t("Cancel tournament")}
        loading={pending("CANCEL_TOURNAMENT")}
        confirmDisabled={reason.trim().length < 3}
        onConfirm={() =>
          cmd.mutate(
            { type: "CANCEL_TOURNAMENT", payload: { reason: reason.trim() } },
            {
              onSuccess: () => {
                toast.success(t("Tournament cancelled"));
                setCancelOpen(false);
                setReason("");
              },
            },
          )
        }
      >
        <Field label={t("Reason")} hint={t("At least 3 characters; recorded in the audit log.")}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function StatsRow({ s }: { s: TournamentSnapshot }) {
  const t = useT();
  const fmt = useFormat();
  const tt = s.tournament;
  const st = s.stats;
  const clock = useDerivedClock(s.clock, s.levels, 1000);
  const started = isStartedStatus(tt.status) || isClosedStatus(tt.status);
  const liveClock = clock && s.clock.status !== "NOT_STARTED" && s.clock.status !== "FINISHED" ? clock : null;
  const currentLevel = liveClock ? s.levels[liveClock.levelIndex] : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat
        label={t("Registered")}
        value={
          <>
            {fmt.number(st.registrations)}
            {tt.maxPlayers ? <span className="text-base text-muted-foreground">/{fmt.number(tt.maxPlayers)}</span> : null}
          </>
        }
        hint={st.waitlisted > 0 ? t("{n} on the waitlist", { n: st.waitlisted }) : undefined}
      />
      <Stat label={t("Checked in")} value={fmt.number(st.checkedIn)} />
      <Stat label={t("Entries")} value={fmt.number(st.entries)} hint={st.reentries > 0 ? t("{n} re-entries", { n: st.reentries }) : undefined} />
      {started && <Stat label={t("Remaining")} value={fmt.number(st.remaining)} hint={st.averageStack != null ? `${t("Average stack")}: ${fmt.number(Math.round(st.averageStack))}` : undefined} />}
      {st.prizePool != null && <Stat label={t("Prize pool")} value={fmt.money(st.prizePool, tt.buyIn?.currency ?? "EUR")} />}
      {liveClock && currentLevel && (
        <Stat
          label={currentLevel.type === "BREAK" ? t("Break") : t("Level {n}", { n: liveClock.playLevelNumber })}
          value={<span className="clock-digits">{liveClock.formatted}</span>}
          hint={currentLevel.type === "PLAY" ? blindsLabel(currentLevel, fmt.number) : s.clock.status === "PAUSED" ? t("Clock paused") : undefined}
        />
      )}
      {!started && (
        <Stat label={t("Structure")} value={t("{n} levels", { n: s.levels.length })} hint={formatDuration(s.levels.reduce((n, l) => n + l.durationSeconds, 0), t)} />
      )}
    </div>
  );
}

// --- configuration ------------------------------------------------------------------------------------

/** Fields with schema defaults; the API resets them when omitted from a PATCH. */
const DEFAULTED_FIELDS: ConfigField[] = ["gameType", "format", "tableSize", "lateRegistrationPolicy", "reentryPolicy", "rebuyPolicy", "addonPolicy", "bountyPolicy"];

function ConfigTab({ s, currency }: { s: TournamentSnapshot; currency: string }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const detail = s.tournament;
  const id = detail.id;

  const [base, setBase] = useState<TournamentDetailView>(detail);
  const [form, setFormState] = useState<TournamentForm>(() => formFromDetail(detail, currency));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConfigField[] | null>(null);
  const [saving, setSaving] = useState(false);

  const baseForm = useMemo(() => formFromDetail(base, currency), [base, currency]);
  const baseSig = stableStringify(baseForm);
  const dirty = stableStringify(form) !== baseSig;
  const serverForm = useMemo(() => formFromDetail(detail, currency), [detail, currency]);
  const serverSig = stableStringify(serverForm);

  // Follow configuration changes from other devices while there are no local edits.
  const [seenSig, setSeenSig] = useState(serverSig);
  if (serverSig !== seenSig) {
    setSeenSig(serverSig);
    if (!dirty) {
      setBase(detail);
      setFormState(serverForm);
    }
  }
  const changedElsewhere = dirty && serverSig !== baseSig;
  useUnsavedChangesWarning(dirty);

  const structure = useStructure(detail.structureId);
  const currentStructure = { id: detail.structureId, name: structure.data?.name ?? t("Blind structure"), levelCount: s.levels.length, totalSeconds: s.levels.reduce((n, l) => n + l.durationSeconds, 0) };

  const canEdit = can("tournament.edit");
  const editable: ReadonlySet<ConfigField> | null = canEdit ? editableFields(detail.status) : new Set<ConfigField>();
  const lockReason = !canEdit ? t("You do not have permission to edit tournaments") : isClosedStatus(detail.status) ? t("Locked: the tournament is over") : t("Locked once seating has started");

  const setForm = (updater: (f: TournamentForm) => TournamentForm) => setFormState((f) => updater(f));
  const fieldNames = (fields: readonly string[]) => fields.map((f) => t(CONFIG_FIELD_LABEL[f] ?? f)).join(", ");

  function discard() {
    setFormState(baseForm);
    setErrors({});
    setConflicts(null);
    setSaveError(null);
  }

  function loadLatest() {
    setBase(detail);
    setFormState(serverForm);
    setErrors({});
    setConflicts(null);
    setSaveError(null);
  }

  /**
   * Only the fields changed here are sent. The version check is strict, so the
   * latest version is fetched first; fields changed elsewhere in the meantime
   * are merged, and a real conflict (same field changed on both sides) stops
   * the save so the operator can decide.
   */
  async function save() {
    setSaveError(null);
    setConflicts(null);
    const built = buildPayload(form, "edit", t);
    setErrors(built.errors);
    if (Object.keys(built.errors).length > 0) {
      scrollToFirstInvalid();
      return;
    }
    setSaving(true);
    try {
      const baseValue = buildPayload(baseForm, "edit", t).value;
      for (let attempt = 0; ; attempt++) {
        const latest = await get<TournamentDetailView>(`/api/v1/tournaments/${id}`);
        const theirsForm = formFromDetail(latest, currency);
        const theirsValue = buildPayload(theirsForm, "edit", t).value;
        const { changedByMe, conflicts: clash } = threeWay(baseValue, built.value, theirsValue, FIELDS.edit);
        if (changedByMe.length === 0) {
          setBase(latest);
          setFormState(theirsForm);
          toast.info(t("Nothing to save"));
          return;
        }
        if (clash.length > 0) {
          setBase(latest);
          setFormState(mergeForms(form, theirsForm, changedByMe));
          setConflicts(clash);
          return;
        }
        const allowed = editableFields(latest.status);
        const blocked = allowed ? changedByMe.filter((k) => !allowed.has(k)) : [];
        if (blocked.length > 0) {
          setBase(latest);
          setFormState(mergeForms(form, theirsForm, changedByMe));
          setSaveError(t("The tournament is now “{status}”; these fields can no longer change: {fields}", { status: t(TOURNAMENT_STATUS_LABEL[latest.status]), fields: fieldNames(blocked) }));
          return;
        }
        // Workaround: the API fills schema defaults into omitted fields of a partial
        // update (TournamentUpdateInput is .partial() over defaulted fields), which would
        // reset them. Send their current values explicitly.
        const body: Record<string, unknown> = { expectedVersion: latest.version, ...pick(built.value, changedByMe) };
        if (!allowed) for (const k of DEFAULTED_FIELDS) if (!(k in body)) body[k] = theirsValue[k];
        try {
          const updated = await patch<TournamentDetailView>(`/api/v1/tournaments/${id}`, body);
          setBase(updated);
          setFormState(formFromDetail(updated, currency));
          setErrors({});
          void qc.invalidateQueries({ queryKey: keys.snapshot(id) });
          void qc.invalidateQueries({ queryKey: keys.actions(id) });
          void qc.invalidateQueries({ queryKey: cfgKeys.tournaments });
          toast.success(t("Configuration saved"));
          return;
        } catch (e) {
          // Another change landed between reading and writing: re-evaluate against it.
          if (e instanceof ApiError && e.isConflict && attempt < 2) continue;
          throw e;
        }
      }
    } catch (e) {
      // Known API issue: after seating starts every PATCH carries defaulted fields that are not
      // live-editable, so the server rejects it. Explain instead of listing untouched fields.
      if (e instanceof ApiError && e.code === "INVALID_STATE" && editableFields(detail.status)) {
        setSaveError(t("The server rejected the change for a tournament that has started ({message}). Blind levels can still be changed in the structure editor.", { message: e.message }));
      } else setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      {editable && editable.size > 0 && (
        <Alert variant="warning" title={isClosedStatus(detail.status) ? t("The tournament is over") : t("The tournament has started")}>
          {t("Only some settings can still change; locked fields are marked. Blind levels after the current one can be edited in the structure editor.")}
        </Alert>
      )}
      {changedElsewhere && (
        <Alert variant="warning" title={t("Changed on another device")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("The configuration was changed elsewhere while you were editing. Saving merges both; fields changed on both sides are reported.")}</span>
            <Button size="sm" variant="outline" onClick={loadLatest}>
              {t("Load latest (discard mine)")}
            </Button>
          </div>
        </Alert>
      )}
      <TournamentConfigFields
        mode="edit"
        form={form}
        setForm={setForm}
        errors={errors}
        editable={editable}
        lockReason={lockReason}
        levels={s.levels}
        currentStructure={currentStructure}
        effectiveHouseRules={detail.houseRules}
      />
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={discard} disabled={!canEdit || !dirty}>
        {conflicts ? (
          <span className="text-warning">{t("Also changed on another device: {fields}. Your values are kept — review and save again.", { fields: fieldNames(conflicts) })}</span>
        ) : saveError ? (
          <span className="text-destructive">{saveError}</span>
        ) : Object.keys(errors).length > 0 ? (
          <span className="text-destructive">{t("Please fix the highlighted fields ({n}).", { n: Object.keys(errors).length })}</span>
        ) : undefined}
      </SaveBar>
    </div>
  );
}

// --- results -----------------------------------------------------------------------------------------------

function ResultsTab({ s }: { s: TournamentSnapshot }) {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const tt = s.tournament;
  const results = useQuery({
    // Same key as the floor console's results panel.
    queryKey: ["tournament", tt.id, "results", tt.version],
    queryFn: () => get<ResultView[]>(`/api/v1/tournaments/${tt.id}/results`),
    enabled: can("results.read"),
  });
  const rows = results.data ?? [];
  const hasPoints = rows.some((r) => r.points != null);
  const hasPrizes = rows.some((r) => r.prizeAmount != null);
  const currency = tt.buyIn?.currency ?? "EUR";

  if (!can("results.read")) return <Alert>{t("You do not have permission to view results.")}</Alert>;
  return (
    <div className="grid gap-4">
      {tt.status === "FINISHED" && (
        <Alert variant="warning" title={t("Provisional results")}>
          <span>
            {t("Finalize the results in floor control to award league points.")}{" "}
            <Link href={`/floor/${tt.id}`} className="text-primary hover:underline">
              {t("Open floor control")}
            </Link>
          </span>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">{t("{n} players ranked", { n: rows.length })}</div>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/v1/tournaments/${tt.id}/results.csv`} download>
            <Download /> {t("Download CSV")}
          </a>
        </Button>
      </div>
      {results.isError && <QueryError error={results.error} onRetry={() => void results.refetch()} />}
      {results.isLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Trophy />} title={t("No results recorded")} />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th className="w-16">{t("Place")}</Th>
              <Th>{t("Player")}</Th>
              <Th className="text-right">{t("Entries")}</Th>
              {hasPoints && <Th className="text-right">{t("Points")}</Th>}
              {hasPrizes && <Th className="text-right">{t("Prize")}</Th>}
              <Th>{t("Status")}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.playerId}>
                <Td className="font-semibold tabular-nums">{r.position}</Td>
                <Td>
                  <Link href={`/admin/players/${r.playerId}`} className="hover:underline">
                    {r.playerName}
                  </Link>
                  {r.revision > 0 && <span className="ml-2 text-xs text-muted-foreground">{t("corrected")}</span>}
                </Td>
                <Td className="text-right tabular-nums">{r.entries}</Td>
                {hasPoints && <Td className="text-right tabular-nums">{r.points != null ? fmt.number(r.points) : "—"}</Td>}
                {hasPrizes && <Td className="text-right tabular-nums">{r.prizeAmount != null ? fmt.money(r.prizeAmount, currency) : "—"}</Td>}
                <Td>
                  <Badge variant={r.status === "FINALIZED" ? "success" : "warning"}>{r.status === "FINALIZED" ? t("Final") : t("Provisional")}</Badge>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

// --- history ------------------------------------------------------------------------------------------------

function HistoryTab({ id }: { id: string }) {
  const t = useT();
  const fmt = useFormat();
  const actions = useQuery({
    queryKey: keys.actions(id),
    queryFn: () => get<OperationalActionView[]>(`/api/v1/tournaments/${id}/actions?limit=200`),
    refetchInterval: 20_000,
  });
  if (actions.isError) return <QueryError error={actions.error} onRetry={() => void actions.refetch()} />;
  if (actions.isLoading) return <TableSkeleton rows={8} />;
  const rows = actions.data ?? [];
  if (rows.length === 0) return <EmptyState icon={<History />} title={t("No actions yet")} />;
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{t("Time")}</Th>
          <Th>{t("Action")}</Th>
          <Th className="hidden md:table-cell">{t("By")}</Th>
          <Th className="text-right">{t("Version")}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((a) => (
          <Tr key={a.id} className={a.compensatedByActionId ? "opacity-60" : undefined}>
            <Td className="whitespace-nowrap tabular-nums">
              <div>{fmt.time(a.createdAt)}</div>
              <div className="text-xs text-muted-foreground">{fmt.date(a.createdAt)}</div>
            </Td>
            <Td>
              <div className={a.compensatedByActionId ? "line-through" : undefined}>{a.summary}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">{a.type}</span>
                {a.compensatedByActionId && <Badge variant="muted">{t("Undone")}</Badge>}
                {a.compensatesActionId && <Badge variant="warning">{t("Undo action")}</Badge>}
              </div>
            </Td>
            <Td className="hidden md:table-cell">
              <div>{a.actorName ?? "—"}</div>
              {a.deviceName && <div className="text-xs text-muted-foreground">{a.deviceName}</div>}
            </Td>
            <Td className="text-right tabular-nums text-muted-foreground">#{a.resultVersion}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
