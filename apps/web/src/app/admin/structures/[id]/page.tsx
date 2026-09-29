"use client";

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@pcos/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Layers, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LevelEditor } from "@/components/admin-config/level-editor";
import { fromViews, levelsSignature, timelineOf, toInputs, validateLevels, type EditableLevel } from "@/components/admin-config/levels";
import { cfgKeys, useStructure } from "@/components/admin-config/queries";
import { isClosedStatus } from "@/components/admin-config/tournament-form";
import type { StructureDetail, StructureSummary } from "@/components/admin-config/types";
import { BackLink, ConfirmDialog, QueryError, SaveBar, useUnsavedChangesWarning } from "@/components/admin-config/ui";
import { useCan } from "@/components/staff-guard";
import { ApiError, del, get, patch, post, put } from "@/lib/api";
import { useDerivedClock } from "@/lib/clock";
import { useT } from "@/lib/i18n";
import { errorMessage, keys, useTournamentSnapshot } from "@/lib/queries";

export default function StructureEditorPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const q = useStructure(id);
  if (q.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div>
        <BackLink href="/admin/structures" label={t("Structures")} />
        {notFound ? <EmptyState icon={<Layers />} title={t("Structure not found")} /> : <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      </div>
    );
  }
  return <StructureEditor key={q.data.id} structure={q.data} />;
}

function StructureEditor({ structure }: { structure: StructureDetail }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const id = structure.id;

  const [baseLevels, setBaseLevels] = useState<EditableLevel[]>(() => fromViews(structure.levels));
  const [levels, setLevels] = useState<EditableLevel[]>(baseLevels);
  const [baseVersion, setBaseVersion] = useState(structure.version);
  const [seenVersion, setSeenVersion] = useState(structure.version);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const baseSig = useMemo(() => levelsSignature(baseLevels), [baseLevels]);
  const dirty = levelsSignature(levels) !== baseSig;
  useUnsavedChangesWarning(dirty);

  const resetTo = (s: Pick<StructureDetail, "levels" | "version">) => {
    const fresh = fromViews(s.levels);
    setBaseLevels(fresh);
    setLevels(fresh);
    setBaseVersion(s.version);
    setSeenVersion(s.version);
    setConflictVersion(null);
  };

  // Follow changes from other devices while there are no local edits.
  if (structure.version !== seenVersion) {
    setSeenVersion(structure.version);
    if (!dirty) resetTo(structure);
  }

  // A tournament's own copy: lock levels already played while it runs.
  const owner = useTournamentSnapshot(structure.ownerTournamentId);
  const ownerSnap = owner.data;
  const clock = useDerivedClock(ownerSnap?.clock, ownerSnap?.levels, 5000);
  const ownerStatus = ownerSnap?.tournament.status ?? null;
  const running = !!ownerSnap && !!clock && ownerSnap.clock.status !== "NOT_STARTED" && ownerSnap.clock.status !== "FINISHED";
  const currentIndex = running ? clock.levelIndex : null;
  const canManage = can("structure.manage");
  const readOnly = !canManage || (ownerStatus != null && isClosedStatus(ownerStatus));

  const issues = useMemo(() => validateLevels(levels, t), [levels, t]);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const timeline = useMemo(() => timelineOf(toInputs(levels)), [levels]);
  const rowName = (index: number) => {
    const n = timeline.playNumbers[index];
    return n != null ? t("Level {n}", { n }) : t("Break (row {n})", { n: index + 1 });
  };

  const save = useMutation({
    mutationFn: (expectedVersion: number) => put<StructureDetail>(`/api/v1/structures/${id}/levels`, { expectedVersion, levels: toInputs(levels) }),
    onSuccess: (res) => {
      qc.setQueryData(cfgKeys.structure(id), res);
      resetTo(res);
      void qc.invalidateQueries({ queryKey: cfgKeys.structures });
      if (structure.ownerTournamentId) void qc.invalidateQueries({ queryKey: keys.snapshot(structure.ownerTournamentId) });
      toast.success(t("Levels saved"));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) setConflictVersion(e.currentVersion ?? null);
    },
  });

  // --- rename / duplicate / delete ---
  const [renameOpen, setRenameOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(structure.name);
  const [description, setDescription] = useState(structure.description ?? "");
  const [dupName, setDupName] = useState(t("{name} (copy)", { name: structure.name }));

  const rename = useMutation({
    mutationFn: () => patch<StructureSummary>(`/api/v1/structures/${id}`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: (res) => {
      // Renaming bumps the version; keep unsaved level edits based on it when nothing else changed.
      if (res.version === baseVersion + 1) setBaseVersion(res.version);
      setSeenVersion(res.version);
      qc.setQueryData<StructureDetail>(cfgKeys.structure(id), (old) => (old ? { ...old, name: res.name, description: res.description, version: res.version } : old));
      void qc.invalidateQueries({ queryKey: cfgKeys.structures });
      setRenameOpen(false);
      toast.success(t("Structure renamed"));
    },
  });
  const duplicate = useMutation({
    mutationFn: () => post<StructureSummary>(`/api/v1/structures/${id}/duplicate`, { name: dupName.trim() || undefined }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: cfgKeys.structures });
      setDupOpen(false);
      toast.success(t("Structure duplicated"));
      router.push(`/admin/structures/${res.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/v1/structures/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.structures });
      qc.removeQueries({ queryKey: cfgKeys.structure(id) });
      toast.success(t("Structure deleted"));
      router.push("/admin/structures");
    },
  });

  const saveError = save.error && !(save.error instanceof ApiError && save.error.isConflict) ? save.error : null;

  return (
    <div>
      {structure.ownerTournamentId ? (
        <BackLink href={`/admin/tournaments/${structure.ownerTournamentId}`} label={ownerSnap?.tournament.name ?? t("Tournament")} />
      ) : (
        <BackLink href="/admin/structures" label={t("Structures")} />
      )}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {structure.name}
            {structure.ownerTournamentId && <Badge variant="secondary">{t("Tournament copy")}</Badge>}
          </span>
        }
        description={structure.description ?? t("Blind levels, breaks and durations.")}
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setRenameOpen(true)}>
                <Pencil /> {t("Rename")}
              </Button>
              <Button variant="outline" onClick={() => setDupOpen(true)}>
                <Copy /> {t("Duplicate")}
              </Button>
              {!structure.ownerTournamentId && (
                <Button variant="outline" onClick={() => setDeleteOpen(true)} className="text-destructive">
                  <Trash2 /> {t("Delete")}
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-4">
        {structure.ownerTournamentId && (
          <Alert title={t("This structure belongs to one tournament")}>
            <div className="grid gap-1">
              <span>
                {t("Changes apply only to")}{" "}
                <Link href={`/admin/tournaments/${structure.ownerTournamentId}`} className="text-primary hover:underline">
                  {ownerSnap?.tournament.name ?? t("the tournament")}
                </Link>
                {t("; library structures and templates are not affected.")}
              </span>
              {running && currentIndex != null && <span className="text-warning">{t("The tournament is running: levels up to the current one ({level}) are locked.", { level: rowName(currentIndex) })}</span>}
              {ownerStatus && isClosedStatus(ownerStatus) && <span className="text-warning">{t("The tournament is over; its structure is read-only.")}</span>}
            </div>
          </Alert>
        )}
        {!canManage && <Alert variant="warning">{t("You can view this structure but not change it.")}</Alert>}

        {conflictVersion != null || (save.error instanceof ApiError && save.error.isConflict) ? (
          <Alert variant="warning" title={t("Changed on another device")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("Someone saved this structure while you were editing. Reload their version or overwrite it with yours.")}</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const fresh = await qc.fetchQuery({ queryKey: cfgKeys.structure(id), queryFn: () => get<StructureDetail>(`/api/v1/structures/${id}`), staleTime: 0 });
                    resetTo(fresh);
                    save.reset();
                  }}
                >
                  {t("Reload latest")}
                </Button>
                <Button size="sm" variant="destructive" disabled={conflictVersion == null || errors.length > 0} loading={save.isPending} onClick={() => conflictVersion != null && save.mutate(conflictVersion)}>
                  {t("Overwrite with mine")}
                </Button>
              </div>
            </div>
          </Alert>
        ) : null}
        {saveError && (
          <Alert variant="destructive" title={saveError instanceof ApiError && saveError.code === "RULE_VIOLATION" ? t("The structure was rejected") : t("Could not save")}>
            {errorMessage(saveError)}
          </Alert>
        )}
        {errors.length > 0 && (
          <Alert variant="destructive" title={t("Fix these problems before saving")}>
            <ul className="list-inside list-disc">
              {errors.slice(0, 8).map((e, i) => (
                <li key={i}>
                  {rowName(e.index)}: {e.message}
                </li>
              ))}
              {errors.length > 8 && <li>{t("…and {n} more", { n: errors.length - 8 })}</li>}
            </ul>
          </Alert>
        )}
        {warnings.length > 0 && errors.length === 0 && (
          <Alert variant="warning">
            <ul className="list-inside list-disc">
              {warnings.slice(0, 5).map((w, i) => (
                <li key={i}>
                  {rowName(w.index)}: {w.message}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <LevelEditor levels={levels} onChange={setLevels} issues={issues} lockedThrough={currentIndex ?? -1} currentIndex={currentIndex} readOnly={readOnly} />
      </div>

      {!readOnly && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          onSave={() => save.mutate(baseVersion)}
          onDiscard={() => {
            setLevels(baseLevels);
            save.reset();
          }}
          saveLabel={t("Save levels")}
          disabled={!dirty || errors.length > 0}
        />
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Rename structure")}</DialogTitle>
          </DialogHeader>
          {rename.isError && <Alert variant="destructive">{errorMessage(rename.error)}</Alert>}
          <Field label={t("Name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
          </Field>
          <Field label={t("Description")}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button disabled={!name.trim()} loading={rename.isPending} onClick={() => rename.mutate()}>
              {t("Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Duplicate structure")}</DialogTitle>
            <DialogDescription>{t("Creates a new library structure with the saved levels.")}</DialogDescription>
          </DialogHeader>
          {dirty && <Alert variant="warning">{t("Unsaved changes are not copied. Save first to include them.")}</Alert>}
          {duplicate.isError && <Alert variant="destructive">{errorMessage(duplicate.error)}</Alert>}
          <Field label={t("Name of the copy")}>
            <Input value={dupName} onChange={(e) => setDupName(e.target.value)} maxLength={120} autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDupOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
              {t("Duplicate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) remove.reset();
        }}
        title={t("Delete “{name}”?", { name: structure.name })}
        description={t("Structures used by a template cannot be deleted. Tournaments keep their own copies.")}
        confirmLabel={t("Delete")}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        {remove.isError && <Alert variant="destructive">{errorMessage(remove.error)}</Alert>}
      </ConfirmDialog>
    </div>
  );
}
