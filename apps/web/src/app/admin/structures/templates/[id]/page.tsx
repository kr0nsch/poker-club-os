"use client";

import { Alert, Button, EmptyState, PageHeader, Skeleton } from "@pcos/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileStack, Trash2, Trophy } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CreateFromTemplateDialog } from "@/components/admin-config/create-from-template-dialog";
import { cfgKeys, useOrganization, useStructure, useStructures } from "@/components/admin-config/queries";
import { TournamentConfigFields } from "@/components/admin-config/tournament-config-fields";
import { buildPayload, emptyForm, formFromTemplate, type FormErrors, type TournamentForm } from "@/components/admin-config/tournament-form";
import type { TournamentTemplate } from "@/components/admin-config/types";
import { BackLink, ConfirmDialog, QueryError, SaveBar, scrollToFirstInvalid, useUnsavedChangesWarning } from "@/components/admin-config/ui";
import { stableStringify } from "@/components/admin-config/utils";
import { useCan } from "@/components/staff-guard";
import { ApiError, del, get, post, put } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const isNew = id === "new";
  const org = useOrganization();
  const structures = useStructures();
  const tpl = useQuery({ queryKey: [...cfgKeys.templates, id], queryFn: () => get<TournamentTemplate>(`/api/v1/templates/${id}`), enabled: !isNew });
  const settled = (!!org.data || org.isError) && (isNew ? !!structures.data || structures.isError : true);

  if (!isNew && tpl.isLoading) return <Skeleton className="h-96" />;
  if (!isNew && !tpl.data) {
    const notFound = tpl.error instanceof ApiError && tpl.error.status === 404;
    return (
      <div>
        <BackLink href="/admin/structures?tab=templates" label={t("Templates")} />
        {notFound ? <EmptyState icon={<FileStack />} title={t("Template not found")} /> : <QueryError error={tpl.error} onRetry={() => void tpl.refetch()} />}
      </div>
    );
  }
  if (!settled) return <Skeleton className="h-96" />;
  const currency = org.data?.settings.currency ?? "EUR";
  const initial = tpl.data ? formFromTemplate(tpl.data, currency) : emptyForm({ currency, structureId: structures.data?.[0]?.id });
  return <TemplateEditor key={tpl.data?.id ?? "new"} template={tpl.data ?? null} initial={initial} />;
}

function TemplateEditor({ template, initial }: { template: TournamentTemplate | null; initial: TournamentForm }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const [base, setBase] = useState(initial);
  const [form, setFormState] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dirty = useMemo(() => stableStringify(form) !== stableStringify(base), [form, base]);
  useUnsavedChangesWarning(dirty);
  const structure = useStructure(form.structureId || null);
  const manage = can("tournament.create");

  const save = useMutation({
    mutationFn: (value: Record<string, unknown>) => (template ? put<TournamentTemplate>(`/api/v1/templates/${template.id}`, value) : post<TournamentTemplate>("/api/v1/templates", value)),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: cfgKeys.templates });
      toast.success(template ? t("Template saved") : t("Template created"));
      if (template) {
        setBase(form);
      } else {
        setBase(form);
        router.replace(`/admin/structures/templates/${saved.id}`);
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/v1/templates/${template!.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.templates });
      toast.success(t("Template deleted"));
      router.push("/admin/structures?tab=templates");
    },
  });

  function submit() {
    const { value, errors: errs } = buildPayload(form, "template", t);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstInvalid();
      return;
    }
    save.mutate(value);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink href="/admin/structures?tab=templates" label={t("Templates")} />
      <PageHeader
        title={template ? template.name : t("New template")}
        description={t("A template stores everything except the date, venue and league; tournaments created from it can still be adjusted.")}
        actions={
          template &&
          manage && (
            <>
              <Button variant="outline" onClick={() => setCreateOpen(true)} disabled={dirty} title={dirty ? t("Save the template first") : undefined}>
                <Trophy /> {t("Create tournament")}
              </Button>
              <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> {t("Delete")}
              </Button>
            </>
          )
        }
      />
      {!manage && <Alert variant="warning" className="mb-4">{t("You can view templates but not change them.")}</Alert>}
      <TournamentConfigFields mode="template" form={form} setForm={(u) => setFormState((f) => u(f))} errors={errors} levels={structure.data?.levels ?? null} editable={manage ? null : new Set()} lockReason={t("Read only")} />
      {manage && (
        <SaveBar dirty={dirty} saving={save.isPending} onSave={submit} onDiscard={() => setFormState(base)} saveLabel={template ? t("Save template") : t("Create template")} disabled={template ? !dirty : false}>
          {save.isError ? (
            <span className="text-destructive">{errorMessage(save.error)}</span>
          ) : Object.keys(errors).length > 0 ? (
            <span className="text-destructive">{t("Please fix the highlighted fields ({n}).", { n: Object.keys(errors).length })}</span>
          ) : undefined}
        </SaveBar>
      )}
      {template && <CreateFromTemplateDialog open={createOpen} onOpenChange={setCreateOpen} templateId={template.id} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("Delete template “{name}”?", { name: template?.name ?? "" })}
        description={t("Tournaments created from it are not affected.")}
        confirmLabel={t("Delete")}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        {remove.isError && <Alert variant="destructive">{errorMessage(remove.error)}</Alert>}
      </ConfirmDialog>
    </div>
  );
}
