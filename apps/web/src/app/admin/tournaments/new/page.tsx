"use client";

import { Alert, Button, Checkbox, Field, PageHeader, Select, Skeleton } from "@pcos/ui";
import type { TournamentDetailView } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { cfgKeys, useOrganization, useStructure, useStructures, useTemplates, useVenues } from "@/components/admin-config/queries";
import { TournamentConfigFields } from "@/components/admin-config/tournament-config-fields";
import { buildPayload, emptyForm, formFromTemplate, type FormErrors, type TournamentForm } from "@/components/admin-config/tournament-form";
import { BackLink, QueryError, Section, scrollToFirstInvalid, useUnsavedChangesWarning } from "@/components/admin-config/ui";
import { nextHourLocalInput } from "@/components/admin-config/utils";
import { useCan } from "@/components/staff-guard";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";

export default function NewTournamentPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <NewTournament />
    </Suspense>
  );
}

function NewTournament() {
  const t = useT();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const templateParam = useSearchParams().get("template");
  const venues = useVenues();
  const structures = useStructures();
  const templates = useTemplates();
  const org = useOrganization();
  const currency = org.data?.settings.currency ?? "EUR";

  const [form, setFormState] = useState<TournamentForm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [publish, setPublish] = useState(false);
  const structure = useStructure(form?.structureId || null);

  // Initialise once the lookups are available (optionally from ?template=<id>).
  const ready = !!venues.data && !!structures.data && (!!org.data || org.isError) && (!templateParam || !!templates.data || templates.isError);
  if (ready && !form) {
    const base = emptyForm({ currency, venueId: venues.data?.[0]?.id, structureId: structures.data?.[0]?.id, startAt: nextHourLocalInput(2) });
    const tpl = templateParam ? templates.data?.find((x) => x.id === templateParam) : undefined;
    setFormState(tpl ? formFromTemplate(tpl, currency, { venueId: base.venueId, startAt: base.startAt }) : base);
  }
  useUnsavedChangesWarning(!!form && !!form.name);

  const setForm = (updater: (f: TournamentForm) => TournamentForm) => setFormState((f) => (f ? updater(f) : f));

  const create = useMutation({
    mutationFn: async (value: Record<string, unknown>) => {
      const created = await post<TournamentDetailView>("/api/v1/tournaments", value);
      let published = false;
      if (publish) {
        try {
          await post(`/api/v1/tournaments/${created.id}/commands`, { type: "PUBLISH", payload: {}, expectedVersion: created.version, clientOperationId: crypto.randomUUID() });
          published = true;
        } catch (e) {
          toast.warning(t("Created, but publishing failed: {message}", { message: errorMessage(e) }));
        }
      }
      return { created, published };
    },
    onSuccess: ({ created, published }) => {
      void qc.invalidateQueries({ queryKey: cfgKeys.tournaments });
      toast.success(published ? t("Tournament created and published") : t("Tournament created"));
      router.push(`/admin/tournaments/${created.id}`);
    },
  });

  function submit() {
    if (!form) return;
    const { value, errors: errs } = buildPayload(form, "create", t);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstInvalid();
      return;
    }
    create.mutate(value);
  }

  function applyTemplate(id: string) {
    if (!form) return;
    const keep = { venueId: form.venueId, startAt: form.startAt, registrationOpenAt: form.registrationOpenAt, registrationCloseAt: form.registrationCloseAt, seasonId: form.seasonId, seriesId: form.seriesId, publicVisibility: form.publicVisibility };
    const tpl = templates.data?.find((x) => x.id === id);
    setFormState(tpl ? formFromTemplate(tpl, currency, keep) : { ...emptyForm({ currency, structureId: structures.data?.[0]?.id }), ...keep });
    setErrors({});
  }

  const loadError = venues.error ?? structures.error;
  const errorCount = Object.keys(errors).length;

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink href="/admin/tournaments" label={t("Tournaments")} />
      <PageHeader title={t("New tournament")} description={t("Configure the tournament; you can change most settings until it starts.")} />
      {!can("tournament.create") && <Alert variant="warning" className="mb-4">{t("You do not have permission to create tournaments.")}</Alert>}
      {loadError && <QueryError error={loadError} onRetry={() => void Promise.all([venues.refetch(), structures.refetch()])} className="mb-4" />}
      {!form ? (
        !loadError && (
          <div className="grid gap-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-72" />
          </div>
        )
      ) : (
        <div className="grid gap-4">
          {(templates.data?.length ?? 0) > 0 && (
            <Section title={t("Start from")} description={t("A template fills in the structure, buy-in and entry options.")}>
              <Field label={t("Template")}>
                <Select value={form.templateId} onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">{t("Blank tournament")}</option>
                  {templates.data?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </Section>
          )}
          <TournamentConfigFields mode="create" form={form} setForm={setForm} errors={errors} levels={structure.data?.levels ?? null} />
          <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
            {create.isError && <Alert variant="destructive" className="mb-3">{errorMessage(create.error)}</Alert>}
            {errorCount > 0 && <Alert variant="warning" className="mb-3">{t("Please fix the highlighted fields ({n}).", { n: errorCount })}</Alert>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {can("tournament.publish") ? <Checkbox label={t("Publish right away")} checked={publish} onChange={(e) => setPublish(e.target.checked)} /> : <span />}
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost">
                  <Link href="/admin/tournaments">{t("Cancel")}</Link>
                </Button>
                <Button onClick={submit} loading={create.isPending} disabled={!can("tournament.create")}>
                  {t("Create tournament")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
