"use client";

import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select } from "@pcos/ui";
import type { TournamentDetailView } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { cfgKeys, useLeagues, useSeries, useTemplates, useVenues } from "./queries";
import { localInputToIso, nextHourLocalInput } from "./utils";

/**
 * Quick creation from a template (POST /templates/:id/tournaments): only venue,
 * name, start time and league/series are asked; everything else comes from the template.
 */
export function CreateFromTemplateDialog({ open, onOpenChange, templateId }: { open: boolean; onOpenChange: (open: boolean) => void; templateId?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <CreateFromTemplateForm templateId={templateId ?? null} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function CreateFromTemplateForm({ templateId, onClose }: { templateId: string | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const templates = useTemplates();
  const venues = useVenues();
  const leagues = useLeagues();
  const series = useSeries();
  const [tplId, setTplId] = useState(templateId ?? "");
  const tpl = templates.data?.find((x) => x.id === tplId);
  const [venueId, setVenueId] = useState("");
  const [name, setName] = useState("");
  const [startAt, setStartAt] = useState(() => nextHourLocalInput(2));
  const [seasonId, setSeasonId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const effectiveVenue = venueId || venues.data?.[0]?.id || "";

  const create = useMutation({
    mutationFn: () => {
      const iso = localInputToIso(startAt);
      return post<TournamentDetailView>(`/api/v1/templates/${tplId}/tournaments`, {
        venueId: effectiveVenue,
        name: name.trim() || undefined,
        startAt: iso && iso !== "invalid" ? iso : undefined,
        seasonId: seasonId || null,
        seriesId: seriesId || null,
      });
    },
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: cfgKeys.tournaments });
      toast.success(t("Tournament created from the template"));
      onClose();
      router.push(`/admin/tournaments/${created.id}`);
    },
  });

  const iso = localInputToIso(startAt);
  const valid = !!tplId && !!effectiveVenue && !!iso && iso !== "invalid";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("Create tournament from template")}</DialogTitle>
        <DialogDescription>{t("Structure, buy-in and entry options are copied from the template. You can adjust everything afterwards.")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        {create.isError && <Alert variant="destructive">{errorMessage(create.error)}</Alert>}
        {!templateId && (
          <Field label={t("Template")}>
            <Select value={tplId} onChange={(e) => setTplId(e.target.value)} disabled={templates.isLoading}>
              <option value="">{t("Choose a template")}</option>
              {templates.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("Tournament name")} hint={tpl ? t("Empty: “{name}”", { name: tpl.name }) : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tpl?.name} maxLength={160} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Venue")}>
            <Select value={effectiveVenue} onChange={(e) => setVenueId(e.target.value)} disabled={venues.isLoading}>
              {venues.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Start time")}>
            <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <Field label={t("Season")}>
            <Select value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
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
          <Field label={t("Series")}>
            <Select
              value={seriesId}
              onChange={(e) => {
                const s = series.data?.find((x) => x.id === e.target.value);
                setSeriesId(e.target.value);
                if (!seasonId && s?.seasonId) setSeasonId(s.seasonId);
              }}
            >
              <option value="">{t("No series")}</option>
              {series.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate()}>
          {t("Create tournament")}
        </Button>
      </DialogFooter>
    </>
  );
}
