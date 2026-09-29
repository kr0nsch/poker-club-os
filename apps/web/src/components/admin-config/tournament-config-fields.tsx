"use client";

import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Skeleton, Switch, Textarea } from "@pcos/ui";
import {
  GAME_TYPES,
  PUBLIC_VISIBILITIES,
  SUPPORTED_TOURNAMENT_FORMATS,
  TOURNAMENT_FORMATS,
  type HouseRulesConfig,
  type LevelView,
  type TournamentFormat,
} from "@pcos/types";
import { ExternalLink, Layers } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { useFormat, useT } from "@/lib/i18n";
import {
  FORMAT_LABEL,
  GAME_TYPE_LABEL,
  HOUSE_RULE_OPTION_LABEL,
  LATE_REG_CLOSE_LABEL,
  REENTRY_CLOSE_LABEL,
  VISIBILITY_HINT,
  VISIBILITY_LABEL,
} from "./labels";
import { playLevelInfo } from "./levels";
import { useDisplayTemplates, useHouseRules, useLeagues, useSeries, useStructures, useVenues } from "./queries";
import { RELEVANT_POLICIES, applyFormat, type ConfigField, type FormErrors, type FormMode, type TournamentForm } from "./tournament-form";
import { LockedNote, MoneyInput, Section, SwitchRow } from "./ui";
import { deviceTimeZone, formatDuration, formatOffset, localInputToIso, parseIntOrNull, unitsToCents } from "./utils";

type SetForm = (updater: (f: TournamentForm) => TournamentForm) => void;
type PolicyKey = "lateReg" | "reentry" | "rebuy" | "addon" | "bounty";

export interface TournamentConfigFieldsProps {
  mode: FormMode;
  form: TournamentForm;
  setForm: SetForm;
  errors: FormErrors;
  /** Fields the API still accepts (edit mode); null = everything is editable. */
  editable?: ReadonlySet<ConfigField> | null;
  /** Why fields are locked, e.g. "Locked while the tournament is running". */
  lockReason?: string;
  /** Levels of the selected / current structure, for level hints. */
  levels?: LevelView[] | null;
  /** Edit mode: the tournament's own copy of its structure. */
  currentStructure?: { id: string; name: string; levelCount: number; totalSeconds: number } | null;
  /** Edit mode: house rules currently applied to the tournament. */
  effectiveHouseRules?: HouseRulesConfig | null;
}

/** Tournament / template configuration: general, schedule, structure, buy-in, league and entry options. */
export function TournamentConfigFields(props: TournamentConfigFieldsProps) {
  const { mode, form, setForm, editable, lockReason } = props;
  const t = useT();
  const [showAllPolicies, setShowAllPolicies] = useState(false);
  const locked = (f: ConfigField) => !!editable && !editable.has(f);
  const set = <K extends keyof TournamentForm>(k: K, v: TournamentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setPolicy = <P extends PolicyKey>(p: P, patch: Partial<TournamentForm[P]>) => setForm((f) => ({ ...f, [p]: { ...f[p], ...patch } }));

  const relevant = RELEVANT_POLICIES[form.format];
  const visible = (p: "reentry" | "rebuy" | "addon" | "bounty") => showAllPolicies || relevant.includes(p) || form[p].enabled;
  const hiddenCount = (["reentry", "rebuy", "addon", "bounty"] as const).filter((p) => !visible(p)).length;
  const ctx: SectionCtx = { ...props, t, locked, set, setPolicy, lockReason: lockReason ?? t("Locked in the current tournament state") };

  return (
    <div className="grid gap-4">
      <GeneralSection {...ctx} />
      {mode !== "template" && <ScheduleSection {...ctx} />}
      <StructureSection {...ctx} />
      <BuyInSection {...ctx} />
      {mode !== "template" && <LeagueSection {...ctx} />}
      <LateRegSection {...ctx} />
      {visible("reentry") && <ReentrySection {...ctx} />}
      {visible("rebuy") && <RebuySection {...ctx} />}
      {visible("addon") && <AddonSection {...ctx} />}
      {visible("bounty") && <BountySection {...ctx} />}
      {(hiddenCount > 0 || showAllPolicies) && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAllPolicies((v) => !v)}>
            {showAllPolicies ? t("Show only options relevant to the format") : t("Show all entry options ({n} more)", { n: hiddenCount })}
          </Button>
        </div>
      )}
    </div>
  );
}

interface SectionCtx extends TournamentConfigFieldsProps {
  t: ReturnType<typeof useT>;
  locked: (f: ConfigField) => boolean;
  set: <K extends keyof TournamentForm>(k: K, v: TournamentForm[K]) => void;
  setPolicy: <P extends PolicyKey>(p: P, patch: Partial<TournamentForm[P]>) => void;
  lockReason: string;
}

function LockableLabel({ label, isLocked, reason }: { label: ReactNode; isLocked: boolean; reason: string }) {
  if (!isLocked) return <>{label}</>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {label}
      <LockedNote>{reason}</LockedNote>
    </span>
  );
}

// --- general ----------------------------------------------------------------------------------------

function GeneralSection({ mode, form, errors, t, locked, set, setForm, lockReason }: SectionCtx) {
  const venues = useVenues();
  const displayTemplates = useDisplayTemplates(mode === "template");
  const L = (f: ConfigField, label: string) => <LockableLabel label={label} isLocked={locked(f)} reason={lockReason} />;
  return (
    <Section title={t("General")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L("name", mode === "template" ? t("Template name") : t("Tournament name"))} error={errors.name} className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} disabled={locked("name")} maxLength={160} placeholder={t("e.g. Sunday Main Event")} aria-invalid={!!errors.name || undefined} />
        </Field>
        {mode === "edit" && (
          <Field label={L("slug", t("Link name (slug)"))} error={errors.slug} hint={t("Used in player links and QR codes. Changing it breaks links already shared.")} className="sm:col-span-2">
            <Input value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} disabled={locked("slug")} className="font-mono" aria-invalid={!!errors.slug || undefined} />
          </Field>
        )}
        <Field label={L("description", t("Description"))} error={errors.description} className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} disabled={locked("description")} rows={3} maxLength={4000} placeholder={t("Shown to players on the schedule and live page")} />
        </Field>
        <Field label={L("gameType", t("Game"))}>
          <Select value={form.gameType} onChange={(e) => set("gameType", e.target.value as TournamentForm["gameType"])} disabled={locked("gameType")}>
            {GAME_TYPES.map((g) => (
              <option key={g} value={g}>
                {t(GAME_TYPE_LABEL[g])}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={L("format", t("Format"))}
          hint={!SUPPORTED_TOURNAMENT_FORMATS.includes(form.format) ? t("This format is modelled but only partly supported by floor control in this release.") : undefined}
        >
          <Select value={form.format} onChange={(e) => setForm((f) => applyFormat(f, e.target.value as TournamentFormat))} disabled={locked("format")}>
            {TOURNAMENT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(FORMAT_LABEL[f])}
                {SUPPORTED_TOURNAMENT_FORMATS.includes(f) ? "" : ` (${t("limited support")})`}
              </option>
            ))}
          </Select>
        </Field>
        {mode === "create" && (
          <Field label={t("Venue")} error={errors.venueId}>
            {venues.isLoading ? (
              <Skeleton className="h-10" />
            ) : (
              <Select value={form.venueId} onChange={(e) => set("venueId", e.target.value)} aria-invalid={!!errors.venueId || undefined}>
                <option value="">{t("Choose a venue")}</option>
                {venues.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {mode !== "template" && (
          <Field label={L("publicVisibility", t("Visibility"))} hint={t(VISIBILITY_HINT[form.publicVisibility])}>
            <Select value={form.publicVisibility} onChange={(e) => set("publicVisibility", e.target.value as TournamentForm["publicVisibility"])} disabled={locked("publicVisibility")}>
              {PUBLIC_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(VISIBILITY_LABEL[v])}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mode === "template" && !displayTemplates.isError && (
          <Field label={t("TV display layout")} hint={t("Optional display template used by screens showing this tournament.")}>
            <Select value={form.displayTemplateId} onChange={(e) => set("displayTemplateId", e.target.value)}>
              <option value="">{t("Default layout")}</option>
              {displayTemplates.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Section>
  );
}

// --- schedule ----------------------------------------------------------------------------------------

function ScheduleSection({ form, errors, t, locked, set, lockReason }: SectionCtx) {
  const L = (f: ConfigField, label: string) => <LockableLabel label={label} isLocked={locked(f)} reason={lockReason} />;
  const tz = deviceTimeZone();
  return (
    <Section title={t("Schedule")} description={tz ? t("Times are in this device's time zone ({tz}).", { tz }) : undefined}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={L("startAt", t("Start time"))} error={errors.startAt}>
          <Input type="datetime-local" value={form.startAt} onChange={(e) => set("startAt", e.target.value)} disabled={locked("startAt")} aria-invalid={!!errors.startAt || undefined} />
        </Field>
        <Field label={L("registrationOpenAt", t("Registration opens"))} error={errors.registrationOpenAt} hint={t("Empty: open registration manually")}>
          <Input type="datetime-local" value={form.registrationOpenAt} onChange={(e) => set("registrationOpenAt", e.target.value)} disabled={locked("registrationOpenAt")} />
        </Field>
        <Field label={L("registrationCloseAt", t("Pre-registration closes"))} error={errors.registrationCloseAt} hint={t("Empty: until the start")}>
          <Input type="datetime-local" value={form.registrationCloseAt} onChange={(e) => set("registrationCloseAt", e.target.value)} disabled={locked("registrationCloseAt")} />
        </Field>
      </div>
    </Section>
  );
}

// --- structure & table ----------------------------------------------------------------------------------

function EffectiveRules({ rules }: { rules: HouseRulesConfig }) {
  const t = useT();
  const items = [
    rules.randomInitialSeating ? t("Random initial seating") : t("Manual initial seating"),
    t(HOUSE_RULE_OPTION_LABEL.tableBreakStrategy[rules.tableBreakStrategy]),
    t("Max imbalance {n}", { n: rules.maxTableImbalance }),
    rules.finalTableSize ? t("Final table of {n}", { n: rules.finalTableSize }) : null,
  ].filter((x): x is string => !!x);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <span>{t("Applied now:")}</span>
      {items.map((i) => (
        <Badge key={i} variant="secondary">
          {i}
        </Badge>
      ))}
    </span>
  );
}

function StructureSection({ mode, form, errors, t, locked, set, lockReason, currentStructure, effectiveHouseRules }: SectionCtx) {
  const structures = useStructures();
  const houseRules = useHouseRules();
  const L = (f: ConfigField, label: string) => <LockableLabel label={label} isLocked={locked(f)} reason={lockReason} />;
  const selected = structures.data?.find((s) => s.id === form.structureId);
  return (
    <Section title={t("Structure and tables")}>
      {mode === "edit" ? (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Layers className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{currentStructure?.name ?? t("Blind structure")}</div>
                {currentStructure && (
                  <div className="text-xs text-muted-foreground">
                    {t("{n} levels", { n: currentStructure.levelCount })} · {formatDuration(currentStructure.totalSeconds, t)} · {t("this tournament's own copy")}
                  </div>
                )}
              </div>
            </div>
            {currentStructure && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/structures/${currentStructure.id}`}>{t("Edit levels")}</Link>
              </Button>
            )}
          </div>
          <Field label={L("structureId", t("Replace with a library structure"))} hint={t("Copies the chosen structure into this tournament; later library edits do not affect it.")}>
            <Select value={form.structureId} onChange={(e) => set("structureId", e.target.value)} disabled={locked("structureId") || structures.isLoading}>
              <option value="">{t("Keep the current structure")}</option>
              {structures.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {t("{n} levels", { n: s.levelCount })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <Field
          label={t("Blind structure")}
          error={errors.structureId}
          hint={
            selected ? (
              <span className="inline-flex flex-wrap items-center gap-x-2">
                {t("{n} levels", { n: selected.levelCount })} · {formatDuration(selected.totalSeconds, t)}
                <Link href={`/admin/structures/${selected.id}`} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {t("Open in the structure editor")} <ExternalLink className="size-3" />
                </Link>
              </span>
            ) : undefined
          }
        >
          {structures.isLoading ? (
            <Skeleton className="h-10" />
          ) : structures.data && structures.data.length === 0 ? (
            <Alert variant="warning" title={t("No blind structures yet")}>
              <Link href="/admin/structures" className="text-primary hover:underline">
                {t("Create a structure first")}
              </Link>
            </Alert>
          ) : (
            <Select value={form.structureId} onChange={(e) => set("structureId", e.target.value)} aria-invalid={!!errors.structureId || undefined}>
              <option value="">{t("Choose a structure")}</option>
              {structures.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {t("{n} levels", { n: s.levelCount })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={L("startingStack", t("Starting stack"))} error={errors.startingStack}>
          <Input inputMode="numeric" value={form.startingStack} onChange={(e) => set("startingStack", e.target.value)} disabled={locked("startingStack")} aria-invalid={!!errors.startingStack || undefined} />
        </Field>
        <Field label={L("tableSize", t("Players per table"))} error={errors.tableSize}>
          <Input type="number" min={2} max={11} value={form.tableSize} onChange={(e) => set("tableSize", e.target.value)} disabled={locked("tableSize")} aria-invalid={!!errors.tableSize || undefined} />
        </Field>
        <Field label={L("maxPlayers", t("Maximum players"))} error={errors.maxPlayers} hint={t("Empty: unlimited")}>
          <Input type="number" min={2} value={form.maxPlayers} onChange={(e) => set("maxPlayers", e.target.value)} disabled={locked("maxPlayers")} />
        </Field>
        <Field label={L("expectedPlayers", t("Expected players"))} error={errors.expectedPlayers} hint={t("For planning tables and staff")}>
          <Input type="number" min={0} value={form.expectedPlayers} onChange={(e) => set("expectedPlayers", e.target.value)} disabled={locked("expectedPlayers")} />
        </Field>
      </div>
      <Field label={L("houseRulesProfileId", t("House rules"))} hint={mode === "edit" && effectiveHouseRules ? <EffectiveRules rules={effectiveHouseRules} /> : undefined}>
        <Select value={form.houseRulesProfileId} onChange={(e) => set("houseRulesProfileId", e.target.value)} disabled={locked("houseRulesProfileId") || houseRules.isLoading}>
          <option value="">{mode === "edit" ? t("No profile") : t("Organization default")}</option>
          {houseRules.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ` (${t("default")})` : ""}
            </option>
          ))}
        </Select>
      </Field>
    </Section>
  );
}

// --- buy-in ------------------------------------------------------------------------------------------

function BuyInSection({ form, errors, t, locked, set, lockReason }: SectionCtx) {
  const fmt = useFormat();
  const isLocked = locked("buyIn");
  const amount = unitsToCents(form.buyInAmount);
  const fee = unitsToCents(form.buyInFee);
  const total = (amount && !Number.isNaN(amount) ? amount : 0) + (fee && !Number.isNaN(fee) ? fee : 0);
  const currency = form.currency.trim().toUpperCase() || "EUR";
  const validCurrency = /^[A-Z]{3}$/.test(currency);
  return (
    <Section title={<LockableLabel label={t("Buy-in")} isLocked={isLocked} reason={lockReason} />} description={t("Leave both empty for a free tournament.")}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Prize pool contribution")} error={errors.buyInAmount}>
          <MoneyInput value={form.buyInAmount} onChange={(v) => set("buyInAmount", v)} currency={currency} disabled={isLocked} invalid={!!errors.buyInAmount} />
        </Field>
        <Field label={t("Fee (house)")} error={errors.buyInFee}>
          <MoneyInput value={form.buyInFee} onChange={(v) => set("buyInFee", v)} currency={currency} disabled={isLocked} invalid={!!errors.buyInFee} />
        </Field>
        <Field label={t("Currency")} error={errors.currency} hint={total > 0 && validCurrency ? t("Player pays {total}", { total: fmt.money(total, currency) }) : undefined}>
          <Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} disabled={isLocked} className="font-mono uppercase" />
        </Field>
      </div>
    </Section>
  );
}

// --- league -------------------------------------------------------------------------------------------

function LeagueSection({ form, t, locked, setForm, lockReason, set }: SectionCtx) {
  const leagues = useLeagues();
  const series = useSeries();
  const L = (f: ConfigField, label: string) => <LockableLabel label={label} isLocked={locked(f)} reason={lockReason} />;
  const seasonName = (id: string | null) => {
    for (const l of leagues.data ?? []) {
      const s = l.seasons.find((x) => x.id === id);
      if (s) return `${l.name} — ${s.name}`;
    }
    return null;
  };
  return (
    <Section title={t("League and series")} description={t("Results of finalized tournaments count toward the season leaderboard.")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L("seasonId", t("Season"))}>
          <Select value={form.seasonId} onChange={(e) => set("seasonId", e.target.value)} disabled={locked("seasonId") || leagues.isLoading}>
            <option value="">{t("Not part of a league")}</option>
            {leagues.data?.map((l) => (
              <optgroup key={l.id} label={l.name}>
                {l.seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={L("seriesId", t("Series"))}>
          <Select
            value={form.seriesId}
            onChange={(e) => {
              const id = e.target.value;
              const s = series.data?.find((x) => x.id === id);
              setForm((f) => ({ ...f, seriesId: id, seasonId: !f.seasonId && s?.seasonId && !locked("seasonId") ? s.seasonId : f.seasonId }));
            }}
            disabled={locked("seriesId") || series.isLoading}
          >
            <option value="">{t("No series")}</option>
            {series.data?.map((s) => {
              const season = seasonName(s.seasonId);
              return (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {season ? ` (${season})` : ""}
                </option>
              );
            })}
          </Select>
        </Field>
      </div>
    </Section>
  );
}

// --- entry options -----------------------------------------------------------------------------------------

function LevelHint({ levels, value, startAt }: { levels: LevelView[] | null | undefined; value: string; startAt?: string }) {
  const t = useT();
  const fmt = useFormat();
  const n = parseIntOrNull(value);
  if (!levels || levels.length === 0 || n == null || Number.isNaN(n)) return null;
  const info = playLevelInfo(levels, n);
  if (!info) {
    const count = levels.filter((l) => l.type === "PLAY").length;
    return <span className="text-warning">{t("The structure has only {n} play levels", { n: count })}</span>;
  }
  const l = info.level;
  const blinds = `${fmt.number(l.smallBlind)}/${fmt.number(l.bigBlind)}${l.anteType !== "NONE" && l.ante ? ` · ${t("ante")} ${fmt.number(l.ante)}` : ""}`;
  const startIso = startAt ? localInputToIso(startAt) : null;
  const end = startIso && startIso !== "invalid" ? new Date(new Date(startIso).getTime() + info.endOffsetSeconds * 1000) : null;
  return (
    <span>
      {t("Level {n}: {blinds}", { n, blinds })} · {end ? t("ends ≈ {time}", { time: fmt.time(end) }) : t("ends {offset} after the start", { offset: formatOffset(info.endOffsetSeconds) })}
    </span>
  );
}

/** Entry option card: title and description on the left, on/off switch on the right. */
function PolicyCard({
  title,
  description,
  enabled,
  onToggle,
  isLocked,
  reason,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  isLocked: boolean;
  reason: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="grid gap-1">
          <CardTitle>
            <label htmlFor={id} className={isLocked ? "cursor-not-allowed" : "cursor-pointer"}>
              {title}
            </label>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
          {isLocked && <LockedNote>{reason}</LockedNote>}
        </div>
        <Switch id={id} checked={enabled} onCheckedChange={onToggle} disabled={isLocked} />
      </CardHeader>
      {enabled && <CardContent className="grid gap-4">{children}</CardContent>}
    </Card>
  );
}

function LateRegSection({ form, errors, t, locked, setPolicy, levels, lockReason }: SectionCtx) {
  const p = form.lateReg;
  const isLocked = locked("lateRegistrationPolicy");
  return (
    <PolicyCard
      title={t("Late registration")}
      description={t("Players may still enter after the start.")}
      enabled={p.enabled}
      onToggle={(v) => setPolicy("lateReg", { enabled: v })}
      isLocked={isLocked}
      reason={lockReason}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Closes")}>
          <Select value={p.closeMode} onChange={(e) => setPolicy("lateReg", { closeMode: e.target.value as typeof p.closeMode })} disabled={isLocked}>
            {(Object.keys(LATE_REG_CLOSE_LABEL) as (keyof typeof LATE_REG_CLOSE_LABEL)[]).map((m) => (
              <option key={m} value={m}>
                {t(LATE_REG_CLOSE_LABEL[m])}
              </option>
            ))}
          </Select>
        </Field>
        {p.closeMode === "LEVEL" && (
          <Field label={t("Open through the end of level")} error={errors["lateReg.untilLevel"]} hint={<LevelHint levels={levels} value={p.untilLevel} startAt={form.startAt} />}>
            <Input type="number" min={1} max={200} value={p.untilLevel} onChange={(e) => setPolicy("lateReg", { untilLevel: e.target.value })} disabled={isLocked} aria-invalid={!!errors["lateReg.untilLevel"] || undefined} />
          </Field>
        )}
        {p.closeMode === "TIME" && (
          <Field label={t("Open until")} error={errors["lateReg.untilTime"]}>
            <Input type="datetime-local" value={p.untilTime} onChange={(e) => setPolicy("lateReg", { untilTime: e.target.value })} disabled={isLocked} aria-invalid={!!errors["lateReg.untilTime"] || undefined} />
          </Field>
        )}
        {p.closeMode === "MANUAL" && <p className="self-end text-sm text-muted-foreground">{t("The director closes late registration from floor control.")}</p>}
      </div>
    </PolicyCard>
  );
}

function ReentrySection({ form, errors, t, locked, setPolicy, levels, lockReason }: SectionCtx) {
  const p = form.reentry;
  const isLocked = locked("reentryPolicy");
  return (
    <PolicyCard
      title={t("Re-entry")}
      description={t("Eliminated players may buy in again for a new starting stack.")}
      enabled={p.enabled}
      onToggle={(v) => setPolicy("reentry", { enabled: v })}
      isLocked={isLocked}
      reason={lockReason}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Re-entries per player")} error={errors["reentry.maxReentries"]} hint={t("Empty: unlimited")}>
          <Input type="number" min={0} max={100} value={p.maxReentries} onChange={(e) => setPolicy("reentry", { maxReentries: e.target.value })} disabled={isLocked} />
        </Field>
        <Field label={t("Available until")}>
          <Select value={p.closeMode} onChange={(e) => setPolicy("reentry", { closeMode: e.target.value as typeof p.closeMode })} disabled={isLocked}>
            {(Object.keys(REENTRY_CLOSE_LABEL) as (keyof typeof REENTRY_CLOSE_LABEL)[]).map((m) => (
              <option key={m} value={m}>
                {t(REENTRY_CLOSE_LABEL[m])}
              </option>
            ))}
          </Select>
        </Field>
        {p.closeMode === "LEVEL" && (
          <Field label={t("Through the end of level")} error={errors["reentry.untilLevel"]} hint={<LevelHint levels={levels} value={p.untilLevel} startAt={form.startAt} />}>
            <Input type="number" min={1} max={200} value={p.untilLevel} onChange={(e) => setPolicy("reentry", { untilLevel: e.target.value })} disabled={isLocked} aria-invalid={!!errors["reentry.untilLevel"] || undefined} />
          </Field>
        )}
      </div>
    </PolicyCard>
  );
}

function RebuySection({ form, errors, t, locked, setPolicy, levels, lockReason }: SectionCtx) {
  const p = form.rebuy;
  const isLocked = locked("rebuyPolicy");
  const currency = form.currency.trim().toUpperCase() || "EUR";
  return (
    <PolicyCard
      title={t("Rebuys")}
      description={t("Players may buy more chips while their stack is low.")}
      enabled={p.enabled}
      onToggle={(v) => setPolicy("rebuy", { enabled: v })}
      isLocked={isLocked}
      reason={lockReason}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("Rebuys per player")} error={errors["rebuy.maxRebuys"]} hint={t("Empty: unlimited")}>
          <Input type="number" min={0} max={100} value={p.maxRebuys} onChange={(e) => setPolicy("rebuy", { maxRebuys: e.target.value })} disabled={isLocked} />
        </Field>
        <Field label={t("Through the end of level")} error={errors["rebuy.untilLevel"]} hint={p.untilLevel ? <LevelHint levels={levels} value={p.untilLevel} startAt={form.startAt} /> : t("Empty: no level limit")}>
          <Input type="number" min={1} max={200} value={p.untilLevel} onChange={(e) => setPolicy("rebuy", { untilLevel: e.target.value })} disabled={isLocked} />
        </Field>
        <Field label={t("Only at or below stack")} error={errors["rebuy.stackThreshold"]} hint={t("Empty: any stack")}>
          <Input inputMode="numeric" value={p.stackThreshold} onChange={(e) => setPolicy("rebuy", { stackThreshold: e.target.value })} disabled={isLocked} />
        </Field>
        <Field label={t("Chips per rebuy")} error={errors["rebuy.chips"]}>
          <Input inputMode="numeric" value={p.chips} onChange={(e) => setPolicy("rebuy", { chips: e.target.value })} disabled={isLocked} aria-invalid={!!errors["rebuy.chips"] || undefined} />
        </Field>
        <Field label={t("Price")} error={errors["rebuy.amount"]}>
          <MoneyInput value={p.amount} onChange={(v) => setPolicy("rebuy", { amount: v })} currency={currency} disabled={isLocked} invalid={!!errors["rebuy.amount"]} />
        </Field>
      </div>
    </PolicyCard>
  );
}

function AddonSection({ form, errors, t, locked, setPolicy, levels, lockReason }: SectionCtx) {
  const p = form.addon;
  const isLocked = locked("addonPolicy");
  const currency = form.currency.trim().toUpperCase() || "EUR";
  return (
    <PolicyCard
      title={t("Add-on")}
      description={t("A one-time chip purchase, usually at the first break.")}
      enabled={p.enabled}
      onToggle={(v) => setPolicy("addon", { enabled: v })}
      isLocked={isLocked}
      reason={lockReason}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("During the break after level")} error={errors["addon.afterLevel"]} hint={p.afterLevel ? <LevelHint levels={levels} value={p.afterLevel} startAt={form.startAt} /> : t("Empty: any time until then")}>
          <Input type="number" min={1} max={200} value={p.afterLevel} onChange={(e) => setPolicy("addon", { afterLevel: e.target.value })} disabled={isLocked} />
        </Field>
        <Field label={t("Add-ons per player")} error={errors["addon.maxAddons"]}>
          <Input type="number" min={1} max={10} value={p.maxAddons} onChange={(e) => setPolicy("addon", { maxAddons: e.target.value })} disabled={isLocked} />
        </Field>
        <Field label={t("Chips per add-on")} error={errors["addon.chips"]}>
          <Input inputMode="numeric" value={p.chips} onChange={(e) => setPolicy("addon", { chips: e.target.value })} disabled={isLocked} aria-invalid={!!errors["addon.chips"] || undefined} />
        </Field>
        <Field label={t("Price")} error={errors["addon.amount"]}>
          <MoneyInput value={p.amount} onChange={(v) => setPolicy("addon", { amount: v })} currency={currency} disabled={isLocked} invalid={!!errors["addon.amount"]} />
        </Field>
      </div>
    </PolicyCard>
  );
}

function BountySection({ form, errors, t, locked, setPolicy, lockReason }: SectionCtx) {
  const p = form.bounty;
  const isLocked = locked("bountyPolicy");
  const currency = form.currency.trim().toUpperCase() || "EUR";
  return (
    <PolicyCard
      title={t("Bounties")}
      description={t("A cash prize for each player eliminated.")}
      enabled={p.enabled}
      onToggle={(v) => setPolicy("bounty", { enabled: v })}
      isLocked={isLocked}
      reason={lockReason}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Bounty per knockout")} error={errors["bounty.amount"]}>
          <MoneyInput value={p.amount} onChange={(v) => setPolicy("bounty", { amount: v })} currency={currency} disabled={isLocked} invalid={!!errors["bounty.amount"]} />
        </Field>
        <SwitchRow
          className="self-end pb-2"
          label={t("Progressive bounty")}
          description={t("Part of each collected bounty is added to the winner's own bounty.")}
          checked={p.progressive}
          onCheckedChange={(v) => setPolicy("bounty", { progressive: v })}
          disabled={isLocked}
        />
      </div>
    </PolicyCard>
  );
}
