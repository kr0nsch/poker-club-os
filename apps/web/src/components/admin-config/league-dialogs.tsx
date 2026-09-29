"use client";

import { Alert, Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, Spinner, Tabs, TabsList, TabsTrigger, Textarea } from "@pcos/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { post, put } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { cfgKeys, useLeagues, useScoreRules } from "./queries";
import type { League, ScoreRule, Season, Series } from "./types";
import { useDebounced } from "./ui";
import { parseIntOrNull, stableStringify } from "./utils";

// --- league ---------------------------------------------------------------------------------------------

export function LeagueDialog({ open, onOpenChange, league }: { open: boolean; onOpenChange: (o: boolean) => void; league: League | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <LeagueForm league={league} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function LeagueForm({ league, onClose }: { league: League | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const rules = useScoreRules();
  const [name, setName] = useState(league?.name ?? "");
  const [description, setDescription] = useState(league?.description ?? "");
  const [scoreRuleId, setScoreRuleId] = useState(league?.scoreRuleId ?? "");
  const [best, setBest] = useState(league?.bestResultsCount != null ? String(league.bestResultsCount) : "");
  const bestN = parseIntOrNull(best);
  const bestError = bestN != null && (Number.isNaN(bestN) || bestN < 1 || bestN > 500) ? t("Between 1 and 500") : null;
  const ruleId = scoreRuleId || rules.data?.[0]?.id || "";
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || null, scoreRuleId: ruleId, bestResultsCount: bestN ?? null };
      return league ? put(`/api/v1/leagues/${league.id}`, body) : post("/api/v1/leagues", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.leagues });
      toast.success(league ? t("League saved") : t("League created"));
      onClose();
    },
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>{league ? t("Edit league") : t("New league")}</DialogTitle>
        <DialogDescription>{t("A league collects points from finalized tournaments of its seasons.")}</DialogDescription>
      </DialogHeader>
      {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
      <Field label={t("Name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
      </Field>
      <Field label={t("Description")}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
      </Field>
      <Field label={t("Score rule")} hint={league ? t("Changing the rule affects future point calculations; use Recalculate to refresh leaderboards.") : undefined}>
        {rules.data && rules.data.length === 0 ? (
          <Alert variant="warning">{t("Create a score rule first (Score rules tab).")}</Alert>
        ) : (
          <Select value={ruleId} onChange={(e) => setScoreRuleId(e.target.value)} disabled={rules.isLoading}>
            {rules.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("Count only the best N results")} error={bestError} hint={t("Empty: all results count")}>
        <Input type="number" min={1} max={500} value={best} onChange={(e) => setBest(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button disabled={!name.trim() || !ruleId || !!bestError} loading={save.isPending} onClick={() => save.mutate()}>
          {league ? t("Save") : t("Create")}
        </Button>
      </DialogFooter>
    </>
  );
}

// --- season -----------------------------------------------------------------------------------------------

export function SeasonDialog({ open, onOpenChange, league, season }: { open: boolean; onOpenChange: (o: boolean) => void; league: League | null; season: Season | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && league && <SeasonForm league={league} season={season} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function SeasonForm({ league, season, onClose }: { league: League; season: Season | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [name, setName] = useState(season?.name ?? String(year));
  const [startsOn, setStartsOn] = useState(season?.startsOn ?? `${year}-01-01`);
  const [endsOn, setEndsOn] = useState(season?.endsOn ?? `${year}-12-31`);
  const dateError = startsOn && endsOn && endsOn < startsOn ? t("The season ends before it starts") : null;
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), startsOn, endsOn };
      return season ? put(`/api/v1/leagues/${league.id}/seasons/${season.id}`, body) : post(`/api/v1/leagues/${league.id}/seasons`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.leagues });
      toast.success(season ? t("Season saved") : t("Season created"));
      onClose();
    },
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>{season ? t("Edit season") : t("New season")}</DialogTitle>
        <DialogDescription>{league.name}</DialogDescription>
      </DialogHeader>
      {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
      <Field label={t("Name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Starts on")}>
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label={t("Ends on")} error={dateError}>
          <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{t("Tournaments are assigned to a season in their configuration.")}</p>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button disabled={!name.trim() || !startsOn || !endsOn || !!dateError} loading={save.isPending} onClick={() => save.mutate()}>
          {season ? t("Save") : t("Create")}
        </Button>
      </DialogFooter>
    </>
  );
}

// --- series -----------------------------------------------------------------------------------------------

export function SeriesDialog({ open, onOpenChange, series }: { open: boolean; onOpenChange: (o: boolean) => void; series: Series | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <SeriesForm series={series} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function SeriesForm({ series, onClose }: { series: Series | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const leagues = useLeagues();
  const [name, setName] = useState(series?.name ?? "");
  const [seasonId, setSeasonId] = useState(series?.seasonId ?? "");
  const [startsOn, setStartsOn] = useState(series?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(series?.endsOn ?? "");
  const dateError = startsOn && endsOn && endsOn < startsOn ? t("The series ends before it starts") : null;
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), seasonId: seasonId || null, startsOn: startsOn || null, endsOn: endsOn || null };
      return series ? put(`/api/v1/series/${series.id}`, body) : post("/api/v1/series", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.series });
      toast.success(series ? t("Series saved") : t("Series created"));
      onClose();
    },
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>{series ? t("Edit series") : t("New series")}</DialogTitle>
        <DialogDescription>{t("A festival or a set of related events, e.g. “Spring Poker Week”.")}</DialogDescription>
      </DialogHeader>
      {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
      <Field label={t("Name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
      </Field>
      <Field label={t("Season")} hint={t("Optional: tournaments of the series usually count for this season.")}>
        <Select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} disabled={leagues.isLoading}>
          <option value="">{t("No season")}</option>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Starts on")}>
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label={t("Ends on")} error={dateError}>
          <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button disabled={!name.trim() || !!dateError} loading={save.isPending} onClick={() => save.mutate()}>
          {series ? t("Save") : t("Create")}
        </Button>
      </DialogFooter>
    </>
  );
}

// --- score rule ---------------------------------------------------------------------------------------------

const VARIABLES: { name: string; help: string }[] = [
  { name: "position", help: "finishing place (1 = winner)" },
  { name: "entrants", help: "all entries, including re-entries" },
  { name: "players", help: "unique players" },
  { name: "buyIn", help: "buy-in amount (prize pool part, in cents)" },
  { name: "reentries", help: "re-entries used by the player" },
  { name: "bounties", help: "knockouts made by the player" },
  { name: "entries", help: "entries used by the player" },
];
const FUNCTIONS = ["sqrt(x)", "ln(x)", "log10(x)", "log(x, base)", "min(a, b, …)", "max(a, b, …)", "round(x)", "floor(x)", "ceil(x)", "abs(x)", "pow(x, y)"];
const DEFAULT_POINTS = ["100", "80", "65", "55", "45", "40", "35", "30", "25", "20"];
const DEFAULT_FORMULA = "max(0, 10 * sqrt(entrants) / sqrt(position) - 1) + 1";

const num = (s: string) => {
  const v = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : Number.NaN;
};

export function ScoreRuleDialog({ open, onOpenChange, rule }: { open: boolean; onOpenChange: (o: boolean) => void; rule: ScoreRule | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>{open && <ScoreRuleForm rule={rule} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ScoreRuleForm({ rule, onClose }: { rule: ScoreRule | null; onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const table = rule?.kind === "POSITION_TABLE" ? rule.config : null;
  const formula = rule?.kind === "FORMULA" ? rule.config : null;
  const [name, setName] = useState(rule?.name ?? "");
  const [kind, setKind] = useState<ScoreRule["kind"]>(rule?.kind ?? "POSITION_TABLE");
  const [points, setPoints] = useState<string[]>(table ? table.points.map(String) : DEFAULT_POINTS);
  const [other, setOther] = useState(String(table?.otherPositionsPoints ?? 0));
  const [participation, setParticipation] = useState(String(table?.participationPoints ?? 0));
  const [bountyPoints, setBountyPoints] = useState(String(table?.bountyPoints ?? 0));
  const [expression, setExpression] = useState(formula?.expression ?? DEFAULT_FORMULA);
  const [minPoints, setMinPoints] = useState(String(formula?.minPoints ?? 0));
  const [roundTo, setRoundTo] = useState(String(formula?.roundTo ?? 2));
  const [entrants, setEntrants] = useState("40");

  const errors: string[] = [];
  let config: Record<string, unknown>;
  if (kind === "POSITION_TABLE") {
    const pts = points.map(num);
    if (pts.length === 0) errors.push(t("Add at least one place"));
    if (pts.some((p) => Number.isNaN(p) || p < 0)) errors.push(t("Points must be numbers of 0 or more"));
    const extras = [other, participation, bountyPoints].map(num);
    if (extras.some((p) => Number.isNaN(p) || p < 0)) errors.push(t("Extra points must be numbers of 0 or more"));
    config = { points: pts, otherPositionsPoints: extras[0], participationPoints: extras[1], bountyPoints: extras[2] };
  } else {
    if (!expression.trim()) errors.push(t("Enter a formula"));
    const mp = num(minPoints);
    const rt = parseIntOrNull(roundTo);
    if (Number.isNaN(mp)) errors.push(t("Minimum points must be a number"));
    if (rt == null || Number.isNaN(rt) || rt < 0 || rt > 4) errors.push(t("Decimals must be between 0 and 4"));
    config = { expression: expression.trim(), minPoints: mp, roundTo: rt ?? 2 };
  }
  const body = { kind, name: name.trim() || "preview", config };
  const entrantsN = Math.max(2, Math.min(2000, parseIntOrNull(entrants) || 40));
  const previewKey = useDebounced(stableStringify({ kind, config, entrantsN }), 400);
  const preview = useQuery({
    queryKey: ["cfg", "score-preview", previewKey],
    queryFn: () => {
      const p = JSON.parse(previewKey) as { kind: string; config: unknown; entrantsN: number };
      return post<{ position: number; points: number }[]>("/api/v1/score-rules/preview", { rule: { kind: p.kind, name: "preview", config: p.config }, entrants: p.entrantsN });
    },
    enabled: errors.length === 0,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: () => (rule ? put(`/api/v1/score-rules/${rule.id}`, { ...body, name: name.trim() }) : post("/api/v1/score-rules", { ...body, name: name.trim() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.scoreRules });
      toast.success(rule ? t("Score rule saved") : t("Score rule created"));
      onClose();
    },
  });

  const setPoint = (i: number, v: string) => setPoints((p) => p.map((x, j) => (j === i ? v : x)));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule ? t("Edit score rule") : t("New score rule")}</DialogTitle>
        <DialogDescription>{t("How many league points each finishing place earns.")}</DialogDescription>
      </DialogHeader>
      {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label={t("Name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus={!rule} />
        </Field>
        <Tabs value={kind} onValueChange={(v) => setKind(v as ScoreRule["kind"])}>
          <TabsList>
            <TabsTrigger value="POSITION_TABLE">{t("Points table")}</TabsTrigger>
            <TabsTrigger value="FORMULA">{t("Formula")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          {kind === "POSITION_TABLE" ? (
            <>
              <div className="grid gap-2">
                <div className="text-sm font-medium">{t("Points by place")}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {points.map((p, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                      <Input className="h-9" inputMode="decimal" value={p} onChange={(e) => setPoint(i, e.target.value)} aria-label={t("Points for place {n}", { n: i + 1 })} aria-invalid={Number.isNaN(num(p)) || undefined} />
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setPoints((p) => [...p, p.length ? String(Math.max(0, Math.floor(num(p[p.length - 1]!) * 0.9) || 0)) : "10"])}>
                    <Plus /> {t("Add place")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setPoints((p) => p.slice(0, -1))} disabled={points.length <= 1}>
                    <Minus /> {t("Remove last")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t("Other places")} hint={t("Points for places beyond the table")}>
                  <Input inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} />
                </Field>
                <Field label={t("Participation")} hint={t("Added for every player")}>
                  <Input inputMode="decimal" value={participation} onChange={(e) => setParticipation(e.target.value)} />
                </Field>
                <Field label={t("Per knockout")} hint={t("Added per bounty won")}>
                  <Input inputMode="decimal" value={bountyPoints} onChange={(e) => setBountyPoints(e.target.value)} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field label={t("Formula")}>
                <Textarea value={expression} onChange={(e) => setExpression(e.target.value)} rows={3} maxLength={500} className="font-mono" spellCheck={false} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("Minimum points")}>
                  <Input inputMode="decimal" value={minPoints} onChange={(e) => setMinPoints(e.target.value)} />
                </Field>
                <Field label={t("Decimals")}>
                  <Input type="number" min={0} max={4} value={roundTo} onChange={(e) => setRoundTo(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{t("Variables")}</div>
                <ul className="grid gap-1">
                  {VARIABLES.map((v) => (
                    <li key={v.name}>
                      <button type="button" className="font-mono text-primary hover:underline" onClick={() => setExpression((e) => `${e}${e && !/\s$/.test(e) ? " " : ""}${v.name}`)}>
                        {v.name}
                      </button>{" "}
                      <span className="text-muted-foreground">— {t(v.help)}</span>
                    </li>
                  ))}
                </ul>
                <div className="font-medium">{t("Functions and operators")}</div>
                <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                  {FUNCTIONS.map((f) => (
                    <span key={f} className="rounded bg-muted px-1.5 py-0.5">
                      {f}
                    </span>
                  ))}
                  <span className="rounded bg-muted px-1.5 py-0.5">+ - * / ^ ( )</span>
                  <span className="rounded bg-muted px-1.5 py-0.5">e pi</span>
                </div>
              </div>
            </>
          )}
          {errors.length > 0 && (
            <Alert variant="destructive">
              <ul className="list-inside list-disc">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>

        <div className="grid content-start gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("Preview")}</span>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("Entrants")}
              <Input className="h-8 w-20" type="number" min={2} max={2000} value={entrants} onChange={(e) => setEntrants(e.target.value)} />
            </label>
          </div>
          {preview.isError ? (
            <Alert variant="destructive">{errorMessage(preview.error)}</Alert>
          ) : preview.isLoading ? (
            <Spinner />
          ) : (
            <div className={cn("grid max-h-80 grid-cols-2 gap-x-4 gap-y-0.5 overflow-y-auto text-sm tabular-nums", (preview.isFetching || previewKey !== stableStringify({ kind, config, entrantsN })) && "opacity-60")}>
              {preview.data?.map((r) => (
                <div key={r.position} className="flex justify-between gap-2 border-b border-border/50 py-0.5">
                  <span className="text-muted-foreground">{r.position}.</span>
                  <span className="font-medium">{fmt.number(r.points)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("Up to the first 50 places, one entry per player, no knockouts.")}</p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button disabled={!name.trim() || errors.length > 0} loading={save.isPending} onClick={() => save.mutate()}>
          {rule ? t("Save") : t("Create")}
        </Button>
      </DialogFooter>
    </>
  );
}
