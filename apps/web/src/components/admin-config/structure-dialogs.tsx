"use client";

import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, Textarea } from "@pcos/ui";
import { ANTE_TYPES, TDA_2026_STYLE, type AnteType, type HouseRulesConfig } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { post, put } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { ANTE_TYPE_LABEL, HOUSE_PRESET_LABEL, HOUSE_RULE_OPTION_LABEL } from "./labels";
import { generateLadder, timelineOf } from "./levels";
import { cfgKeys } from "./queries";
import type { HouseRulesProfile, StructureSummary } from "./types";
import { SwitchRow } from "./ui";
import { formatDuration, parseIntOrNull, sameValue } from "./utils";

// --- house rules ------------------------------------------------------------------------------------

/** Create (profile = null) or edit a house rules profile. */
export function HouseRulesDialog({ open, onOpenChange, profile }: { open: boolean; onOpenChange: (open: boolean) => void; profile: HouseRulesProfile | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>{open && <HouseRulesForm profile={profile} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function HouseRulesForm({ profile, onClose }: { profile: HouseRulesProfile | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.name ?? "");
  const [preset, setPreset] = useState<"TDA_2026_STYLE" | "CUSTOM">(profile?.preset ?? "TDA_2026_STYLE");
  const [config, setConfig] = useState<HouseRulesConfig>(profile ? { ...TDA_2026_STYLE, ...profile.config } : { ...TDA_2026_STYLE });
  const [finalTable, setFinalTable] = useState(profile?.config.finalTableSize != null ? String(profile.config.finalTableSize) : "");

  // Editing a preset value turns the profile into a custom one.
  const setField = <K extends keyof HouseRulesConfig>(k: K, v: HouseRulesConfig[K]) => {
    const next = { ...config, [k]: v };
    setConfig(next);
    if (preset === "TDA_2026_STYLE" && !sameValue({ ...next, finalTableSize: null }, TDA_2026_STYLE)) setPreset("CUSTOM");
  };
  const ft = parseIntOrNull(finalTable);
  const finalTableError = ft != null && (Number.isNaN(ft) || ft < 2 || ft > 11) ? t("Between 2 and 11") : null;

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), preset, config: { ...config, finalTableSize: ft ?? null } };
      return profile ? put<HouseRulesProfile>(`/api/v1/house-rules/${profile.id}`, body) : post<HouseRulesProfile>("/api/v1/house-rules", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.houseRules });
      toast.success(profile ? t("House rules updated") : t("House rules profile created"));
      onClose();
    },
  });

  const opt = HOUSE_RULE_OPTION_LABEL;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{profile ? t("Edit house rules") : t("New house rules profile")}</DialogTitle>
        <DialogDescription>{t("Seating, balancing and table-breaking rules applied by floor control. New tournaments copy the profile's rules.")}</DialogDescription>
      </DialogHeader>
      {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus={!profile} />
        </Field>
        <Field label={t("Preset")}>
          <Select
            value={preset}
            onChange={(e) => {
              const p = e.target.value as typeof preset;
              setPreset(p);
              if (p === "TDA_2026_STYLE") {
                setConfig({ ...TDA_2026_STYLE });
                setFinalTable("");
              }
            }}
          >
            {(Object.keys(HOUSE_PRESET_LABEL) as (keyof typeof HOUSE_PRESET_LABEL)[]).map((p) => (
              <option key={p} value={p}>
                {t(HOUSE_PRESET_LABEL[p])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 rounded-lg border border-border p-4">
        <div className="text-sm font-medium">{t("Seating")}</div>
        <SwitchRow label={t("Random initial seating")} description={t("Draw seats at random when seating starts.")} checked={config.randomInitialSeating} onCheckedChange={(v) => setField("randomInitialSeating", v)} />
        <Field label={t("Late registrations are seated")}>
          <Select value={config.lateRegistrationSeatPolicy} onChange={(e) => setField("lateRegistrationSeatPolicy", e.target.value as HouseRulesConfig["lateRegistrationSeatPolicy"])}>
            {Object.entries(opt.lateRegistrationSeatPolicy).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </Select>
        </Field>
        <SwitchRow label={t("Allow seat locks")} description={t("Floor staff may lock seats (e.g. for a player with a disability).")} checked={config.seatLockingEnabled} onCheckedChange={(v) => setField("seatLockingEnabled", v)} />
      </div>
      <div className="grid gap-4 rounded-lg border border-border p-4">
        <div className="text-sm font-medium">{t("Balancing and breaking tables")}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Break tables in this order")}>
            <Select value={config.tableBreakStrategy} onChange={(e) => setField("tableBreakStrategy", e.target.value as HouseRulesConfig["tableBreakStrategy"])}>
              {Object.entries(opt.tableBreakStrategy).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Balancing")}>
            <Select value={config.tableBalanceStrategy} onChange={(e) => setField("tableBalanceStrategy", e.target.value as HouseRulesConfig["tableBalanceStrategy"])}>
              {Object.entries(opt.tableBalanceStrategy).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Player to move when balancing")}>
            <Select value={config.balancePlayerSelection} onChange={(e) => setField("balancePlayerSelection", e.target.value as HouseRulesConfig["balancePlayerSelection"])}>
              {Object.entries(opt.balancePlayerSelection).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Maximum table imbalance (players)")}>
            <Input type="number" min={1} max={5} value={config.maxTableImbalance} onChange={(e) => setField("maxTableImbalance", Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
          <Field label={t("Severe imbalance threshold")} hint={t("Difference in players that counts as severe.")}>
            <Input type="number" min={2} max={9} value={config.severeImbalanceThreshold} onChange={(e) => setField("severeImbalanceThreshold", Math.min(9, Math.max(2, Number(e.target.value) || 2)))} />
          </Field>
          <Field label={t("Final table size")} error={finalTableError} hint={t("Empty: same as the table size")}>
            <Input type="number" min={2} max={11} value={finalTable} onChange={(e) => setFinalTable(e.target.value)} />
          </Field>
        </div>
        <SwitchRow label={t("Halt play on severe imbalance")} description={t("Floor control asks to pause until tables are balanced.")} checked={config.haltPlayOnSevereImbalance} onCheckedChange={(v) => setField("haltPlayOnSevereImbalance", v)} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button disabled={!name.trim() || !!finalTableError} loading={save.isPending} onClick={() => save.mutate()}>
          {profile ? t("Save") : t("Create")}
        </Button>
      </DialogFooter>
    </>
  );
}

// --- new structure ------------------------------------------------------------------------------------

/** Clamp an integer typed in an input, falling back when empty or malformed. */
function n(s: string, min: number, max: number, fallback: number) {
  const v = parseIntOrNull(s);
  return v == null || Number.isNaN(v) ? fallback : Math.min(max, Math.max(min, v));
}

/** New structure with a generated starting ladder (the API requires at least one level). */
export function NewStructureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <NewStructureForm onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function NewStructureForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [o, setO] = useState({ levels: "16", minutes: "20", startBigBlind: "200", breakEvery: "4", breakMinutes: "10", anteFromLevel: "4", anteType: "BIG_BLIND" as AnteType });
  const ladder = useMemo(
    () =>
      generateLadder({
        levels: n(o.levels, 1, 60, 16),
        minutes: n(o.minutes, 1, 360, 20),
        startBigBlind: n(o.startBigBlind, 2, 10_000_000, 200),
        breakEvery: n(o.breakEvery, 0, 60, 0),
        breakMinutes: n(o.breakMinutes, 1, 120, 10),
        anteFromLevel: o.anteFromLevel.trim() ? n(o.anteFromLevel, 1, 60, 1) : null,
        anteType: o.anteType,
        breakLabel: t("Break"),
      }),
    [o, t],
  );
  const tl = timelineOf(ladder);
  const plays = ladder.filter((l) => l.type === "PLAY");
  const first = plays[0];
  const last = plays[plays.length - 1];

  const create = useMutation({
    mutationFn: () => post<StructureSummary>("/api/v1/structures", { name: name.trim(), description: description.trim() || null, levels: ladder }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: cfgKeys.structures });
      toast.success(t("Structure created"));
      onClose();
      router.push(`/admin/structures/${s.id}`);
    },
  });
  const set = (k: keyof typeof o) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setO((p) => ({ ...p, [k]: e.target.value }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New structure")}</DialogTitle>
        <DialogDescription>{t("Start from a generated ladder and fine-tune every level in the editor.")}</DialogDescription>
      </DialogHeader>
      {create.isError && <Alert variant="destructive">{errorMessage(create.error)}</Alert>}
      <Field label={t("Name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("e.g. Deepstack 30 min")} autoFocus />
      </Field>
      <Field label={t("Description")}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={t("Play levels")}>
          <Input type="number" min={1} max={60} value={o.levels} onChange={set("levels")} />
        </Field>
        <Field label={t("Minutes per level")}>
          <Input type="number" min={1} value={o.minutes} onChange={set("minutes")} />
        </Field>
        <Field label={t("First big blind")}>
          <Input inputMode="numeric" value={o.startBigBlind} onChange={set("startBigBlind")} />
        </Field>
        <Field label={t("Break every N levels")} hint={t("0: no breaks")}>
          <Input type="number" min={0} value={o.breakEvery} onChange={set("breakEvery")} />
        </Field>
        <Field label={t("Break minutes")}>
          <Input type="number" min={1} value={o.breakMinutes} onChange={set("breakMinutes")} />
        </Field>
        <Field label={t("Ante from level")} hint={t("Empty: no ante")}>
          <Input type="number" min={1} value={o.anteFromLevel} onChange={set("anteFromLevel")} />
        </Field>
        <Field label={t("Ante type")} className="col-span-2 sm:col-span-3">
          <Select value={o.anteType} onChange={set("anteType")}>
            {ANTE_TYPES.filter((a) => a !== "NONE").map((a) => (
              <option key={a} value={a}>
                {t(ANTE_TYPE_LABEL[a])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {first && last && (
        <p className="text-sm text-muted-foreground">
          {t("{n} levels", { n: ladder.length })} · {formatDuration(tl.total, t)} · {fmt.number(first.smallBlind)}/{fmt.number(first.bigBlind)} → {fmt.number(last.smallBlind)}/{fmt.number(last.bigBlind)}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
          {t("Create and edit levels")}
        </Button>
      </DialogFooter>
    </>
  );
}
