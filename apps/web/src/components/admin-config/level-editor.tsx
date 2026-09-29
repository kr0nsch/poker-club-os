"use client";

import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@pcos/ui";
import { ANTE_TYPES, type AnteType, type LevelType } from "@pcos/types";
import { ArrowDown, ArrowUp, Coffee, Copy, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useFormat, useT } from "@/lib/i18n";
import { ANTE_TYPE_LABEL } from "./labels";
import { anteFor, durationSecondsOf, newBreak, newKey, suggestNextLevel, timelineOf, type EditableLevel, type LevelIssue, type TimelineInfo } from "./levels";
import { formatDuration, formatOffset, parseIntOrNull } from "./utils";

const num = (s: string) => {
  const n = parseIntOrNull(s);
  return n == null || Number.isNaN(n) ? 0 : n;
};

export interface LevelEditorProps {
  levels: EditableLevel[];
  onChange: (levels: EditableLevel[]) => void;
  issues: LevelIssue[];
  /** Rows 0..lockedThrough are played / in play and cannot change (-1 = none). */
  lockedThrough: number;
  /** Index of the level currently in play, if the owning tournament runs. */
  currentIndex: number | null;
  readOnly: boolean;
}

/** Blind level builder: inline editing, row actions, bulk edit and a timeline preview. */
export function LevelEditor({ levels, onChange, issues, lockedThrough, currentIndex, readOnly }: LevelEditorProps) {
  const t = useT();
  const fmt = useFormat();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const timeline = useMemo(() => timelineOf(levels.map((l) => ({ type: l.type, durationSeconds: durationSecondsOf(l) }))), [levels]);
  const rowIssues = useMemo(() => {
    const m = new Map<number, LevelIssue[]>();
    for (const i of issues) m.set(i.index, [...(m.get(i.index) ?? []), i]);
    return m;
  }, [issues]);

  const locked = (i: number) => readOnly || i <= lockedThrough;
  const invalid = (i: number, field: LevelIssue["field"]) => rowIssues.get(i)?.some((x) => x.field === field && x.severity === "error") || undefined;
  const editableKeys = levels.filter((_, i) => !locked(i)).map((l) => l.key);
  const selectedRows = levels.map((l, i) => ({ l, i })).filter(({ l, i }) => selected.has(l.key) && !locked(i));

  const update = (i: number, patch: Partial<EditableLevel>) => onChange(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const insertAt = (i: number, level: EditableLevel) => onChange([...levels.slice(0, i), level, ...levels.slice(i)]);
  const removeAt = (i: number) => onChange(levels.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= levels.length || locked(i) || locked(j)) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const changeType = (i: number, type: LevelType) => {
    const l = levels[i]!;
    if (type === "BREAK") update(i, { type, label: l.label || t("Break"), anteType: "NONE" });
    else {
      const s = suggestNextLevel(levels.slice(0, i));
      update(i, { type, smallBlind: s.smallBlind, bigBlind: s.bigBlind, ante: s.ante, anteType: s.anteType, label: l.label === t("Break") ? "" : l.label });
    }
  };
  const changeAnteType = (i: number, anteType: AnteType) => {
    const l = levels[i]!;
    update(i, { anteType, ante: String(anteFor(anteType, num(l.bigBlind), num(l.ante))) });
  };

  // --- bulk ---
  const [bulkMinutes, setBulkMinutes] = useState("");
  const [bulkFactor, setBulkFactor] = useState("2");
  const [bulkAnte, setBulkAnte] = useState<AnteType>("BIG_BLIND");
  const applyBulk = (fn: (l: EditableLevel) => EditableLevel) => {
    const keys = new Set(selectedRows.map((r) => r.l.key));
    onChange(levels.map((l) => (keys.has(l.key) ? fn(l) : l)));
  };
  const factor = Number.parseFloat(bulkFactor.replace(",", "."));
  const minutes = Number.parseFloat(bulkMinutes.replace(",", "."));

  const toggleAll = () => setSelected(selectedRows.length === editableKeys.length ? new Set() : new Set(editableKeys));
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const next = suggestNextLevel(levels);

  return (
    <div className="grid gap-4">
      <TimelinePreview levels={levels} timeline={timeline} currentIndex={currentIndex} />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onChange([...levels, next])}>
            <Plus /> {t("Add level")} <span className="text-primary-foreground/70 tabular-nums">{`${fmt.number(num(next.smallBlind))}/${fmt.number(num(next.bigBlind))}`}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => onChange([...levels, newBreak(levels, t("Break"))])}>
            <Coffee /> {t("Add break")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("Select rows to edit several levels at once.")}</span>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="grid gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("{n} rows selected", { n: selectedRows.length })}</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X /> {t("Clear selection")}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-end gap-2">
              <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
                {t("Duration (min)")}
                <Input className="h-8" inputMode="decimal" value={bulkMinutes} onChange={(e) => setBulkMinutes(e.target.value)} placeholder="20" />
              </label>
              <Button size="sm" variant="outline" disabled={!(minutes > 0)} onClick={() => applyBulk((l) => ({ ...l, minutes: String(minutes) }))}>
                {t("Set")}
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
                {t("Multiply blinds and antes by")}
                <Input className="h-8" inputMode="decimal" value={bulkFactor} onChange={(e) => setBulkFactor(e.target.value)} />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={!(factor > 0)}
                onClick={() =>
                  applyBulk((l) =>
                    l.type === "PLAY"
                      ? { ...l, smallBlind: String(Math.round(num(l.smallBlind) * factor)), bigBlind: String(Math.round(num(l.bigBlind) * factor)), ante: String(Math.round(num(l.ante) * factor)) }
                      : l,
                  )
                }
              >
                {t("Apply")}
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
                {t("Ante type")}
                <Select className="h-8 py-1" value={bulkAnte} onChange={(e) => setBulkAnte(e.target.value as AnteType)}>
                  {ANTE_TYPES.map((a) => (
                    <option key={a} value={a}>
                      {t(ANTE_TYPE_LABEL[a])}
                    </option>
                  ))}
                </Select>
              </label>
              <Button size="sm" variant="outline" onClick={() => applyBulk((l) => (l.type === "PLAY" ? { ...l, anteType: bulkAnte, ante: String(anteFor(bulkAnte, num(l.bigBlind), num(l.ante))) } : l))}>
                {t("Set")}
              </Button>
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  const keys = new Set(selectedRows.map((r) => r.l.key));
                  onChange(levels.filter((l) => !keys.has(l.key)));
                  setSelected(new Set());
                }}
              >
                <Trash2 /> {t("Delete selected")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Table>
        <THead>
          <Tr>
            {!readOnly && (
              <Th className="w-8">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={t("Select all")} checked={editableKeys.length > 0 && selectedRows.length === editableKeys.length} onChange={toggleAll} disabled={editableKeys.length === 0} />
              </Th>
            )}
            <Th className="w-12">{t("Level")}</Th>
            <Th className="w-28">{t("Type")}</Th>
            <Th>{t("Small blind")}</Th>
            <Th>{t("Big blind")}</Th>
            <Th>{t("Ante")}</Th>
            <Th>{t("Ante type")}</Th>
            <Th>{t("Minutes")}</Th>
            <Th className="min-w-40">{t("Label")}</Th>
            <Th className="text-right">{t("Starts")}</Th>
            {!readOnly && <Th className="w-0" />}
          </Tr>
        </THead>
        <TBody>
          {levels.map((l, i) => {
            const isLocked = locked(i);
            const problems = rowIssues.get(i) ?? [];
            const hasError = problems.some((p) => p.severity === "error");
            const cellInput = "h-8 w-24 px-2 tabular-nums";
            return (
              <Tr
                key={l.key}
                className={cn(
                  l.type === "BREAK" && "bg-warning/5",
                  hasError && "bg-destructive/10",
                  i === currentIndex && "bg-primary/10",
                  isLocked && !readOnly && "opacity-70",
                )}
              >
                {!readOnly && (
                  <Td>
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={t("Select row")} checked={selected.has(l.key)} disabled={isLocked} onChange={() => toggle(l.key)} />
                  </Td>
                )}
                <Td className="tabular-nums">
                  {l.type === "BREAK" ? <Coffee className="size-4 text-warning" aria-label={t("Break")} /> : <span className="font-medium">{timeline.playNumbers[i]}</span>}
                  {i === currentIndex && (
                    <Badge variant="success" className="mt-1">
                      {t("Now")}
                    </Badge>
                  )}
                </Td>
                <Td>
                  <Select className="h-8 py-1" value={l.type} onChange={(e) => changeType(i, e.target.value as LevelType)} disabled={isLocked} aria-label={t("Type")}>
                    <option value="PLAY">{t("Play")}</option>
                    <option value="BREAK">{t("Break")}</option>
                  </Select>
                </Td>
                {l.type === "PLAY" ? (
                  <>
                    <Td>
                      <Input className={cellInput} inputMode="numeric" value={l.smallBlind} onChange={(e) => update(i, { smallBlind: e.target.value })} disabled={isLocked} aria-label={t("Small blind")} aria-invalid={invalid(i, "smallBlind")} />
                    </Td>
                    <Td>
                      <Input
                        className={cellInput}
                        inputMode="numeric"
                        value={l.bigBlind}
                        onChange={(e) => {
                          const bb = e.target.value;
                          update(i, { bigBlind: bb, ...(l.anteType === "BIG_BLIND" && num(l.ante) === num(l.bigBlind) ? { ante: bb } : {}) });
                        }}
                        disabled={isLocked}
                        aria-label={t("Big blind")}
                        aria-invalid={invalid(i, "bigBlind")}
                      />
                    </Td>
                    <Td>
                      <Input className={cellInput} inputMode="numeric" value={l.ante} onChange={(e) => update(i, { ante: e.target.value })} disabled={isLocked} aria-label={t("Ante")} aria-invalid={invalid(i, "ante")} />
                    </Td>
                    <Td>
                      <Select className="h-8 w-36 py-1" value={l.anteType} onChange={(e) => changeAnteType(i, e.target.value as AnteType)} disabled={isLocked} aria-label={t("Ante type")} aria-invalid={invalid(i, "anteType")}>
                        {ANTE_TYPES.map((a) => (
                          <option key={a} value={a}>
                            {t(ANTE_TYPE_LABEL[a])}
                          </option>
                        ))}
                      </Select>
                    </Td>
                  </>
                ) : (
                  <Td colSpan={4} className="text-sm italic text-muted-foreground">
                    {t("Break — the clock keeps running, no blinds")}
                  </Td>
                )}
                <Td>
                  <Input className="h-8 w-20 px-2 tabular-nums" inputMode="decimal" value={l.minutes} onChange={(e) => update(i, { minutes: e.target.value })} disabled={isLocked} aria-label={t("Minutes")} aria-invalid={invalid(i, "minutes")} />
                </Td>
                <Td>
                  <Input className="h-8 px-2" value={l.label} onChange={(e) => update(i, { label: e.target.value })} disabled={isLocked} maxLength={60} placeholder={l.type === "BREAK" ? t("Break") : ""} aria-label={t("Label")} />
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{formatOffset(timeline.starts[i] ?? 0)}</Td>
                {!readOnly && (
                  <Td className="whitespace-nowrap">
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="sm" className="px-2" onClick={() => move(i, -1)} disabled={isLocked || i === 0 || locked(i - 1)} aria-label={t("Move up")}>
                        <ArrowUp />
                      </Button>
                      <Button variant="ghost" size="sm" className="px-2" onClick={() => move(i, 1)} disabled={isLocked || i === levels.length - 1} aria-label={t("Move down")}>
                        <ArrowDown />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="px-2" aria-label={t("Row actions")}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={i < lockedThrough} onSelect={() => insertAt(i + 1, suggestNextLevel(levels.slice(0, i + 1)))}>
                            <Plus /> {t("Insert level after")}
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={i < lockedThrough} onSelect={() => insertAt(i + 1, newBreak(levels.slice(0, i + 1), t("Break")))}>
                            <Coffee /> {t("Insert break after")}
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={i < lockedThrough} onSelect={() => insertAt(i + 1, { ...l, key: newKey() })}>
                            <Copy /> {t("Duplicate")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive disabled={isLocked} onSelect={() => removeAt(i)}>
                            <Trash2 /> {t("Delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Td>
                )}
              </Tr>
            );
          })}
        </TBody>
      </Table>
      {!readOnly && levels.length > 8 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onChange([...levels, next])}>
            <Plus /> {t("Add level")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onChange([...levels, newBreak(levels, t("Break"))])}>
            <Coffee /> {t("Add break")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Proportional bar of the structure with breaks highlighted and hour ticks. */
export function TimelinePreview({ levels, timeline, currentIndex }: { levels: EditableLevel[]; timeline: TimelineInfo; currentIndex: number | null }) {
  const t = useT();
  const fmt = useFormat();
  const total = timeline.total || 1;
  const hours = Math.floor(timeline.total / 3600);
  const plays = levels.filter((l) => l.type === "PLAY");
  const first = plays[0];
  const last = plays[plays.length - 1];
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-muted-foreground">{t("Total")}: </span>
          <span className="font-medium">{formatDuration(timeline.total, t)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">{t("Play levels")}: </span>
          <span className="font-medium tabular-nums">{timeline.playCount}</span>
        </span>
        <span>
          <span className="text-muted-foreground">{t("Break periods")}: </span>
          <span className="font-medium tabular-nums">{timeline.breakCount}</span>
        </span>
        {first && last && (
          <span>
            <span className="text-muted-foreground">{t("Blinds")}: </span>
            <span className="font-medium tabular-nums">
              {fmt.number(num(first.smallBlind))}/{fmt.number(num(first.bigBlind))} → {fmt.number(num(last.smallBlind))}/{fmt.number(num(last.bigBlind))}
            </span>
          </span>
        )}
      </div>
      <div className="relative pb-4">
        <div className="flex h-7 overflow-hidden rounded-md border border-border">
          {levels.map((l, i) => {
            const d = durationSecondsOf(l);
            const label = l.type === "BREAK" ? `${t("Break")} · ${formatDuration(d, t)}` : `${t("Level {n}", { n: timeline.playNumbers[i] ?? "" })} · ${fmt.number(num(l.smallBlind))}/${fmt.number(num(l.bigBlind))} · ${formatDuration(d, t)}`;
            return (
              <div
                key={l.key}
                title={`${label} · ${t("starts at {offset}", { offset: formatOffset(timeline.starts[i] ?? 0) })}`}
                style={{ width: `${(Math.max(0, d) / total) * 100}%` }}
                className={cn(
                  "h-full border-r border-background/60 last:border-r-0",
                  l.type === "BREAK" ? "bg-warning/70" : i % 2 ? "bg-primary/40" : "bg-primary/25",
                  i === currentIndex && "ring-2 ring-inset ring-foreground",
                )}
              />
            );
          })}
        </div>
        {Array.from({ length: hours }, (_, h) => (
          <span key={h} className="absolute bottom-0 -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ left: `${(((h + 1) * 3600) / total) * 100}%` }}>
            {t("{h}h", { h: h + 1 })}
          </span>
        ))}
      </div>
    </div>
  );
}
