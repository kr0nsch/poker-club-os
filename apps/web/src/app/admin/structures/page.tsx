"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pcos/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, FileStack, Layers, MoreHorizontal, Pencil, Plus, ScrollText, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { CreateFromTemplateDialog } from "@/components/admin-config/create-from-template-dialog";
import { FORMAT_LABEL, GAME_TYPE_LABEL, HOUSE_PRESET_LABEL, HOUSE_RULE_OPTION_LABEL } from "@/components/admin-config/labels";
import { cfgKeys, useHouseRules, useStructures, useTemplates } from "@/components/admin-config/queries";
import { HouseRulesDialog, NewStructureDialog } from "@/components/admin-config/structure-dialogs";
import type { HouseRulesProfile, StructureSummary, TournamentTemplate } from "@/components/admin-config/types";
import { ConfirmDialog, QueryError, TableSkeleton } from "@/components/admin-config/ui";
import { formatDuration } from "@/components/admin-config/utils";
import { useCan } from "@/components/staff-guard";
import { del, post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";

const TABS = ["structures", "templates", "house-rules"] as const;

export default function StructuresPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <StructuresHome />
    </Suspense>
  );
}

function StructuresHome() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const param = useSearchParams().get("tab");
  const tab = (TABS as readonly string[]).includes(param ?? "") ? (param as (typeof TABS)[number]) : "structures";
  return (
    <div>
      <PageHeader title={t("Structures & templates")} description={t("Blind structures, reusable tournament templates and house rules.")} />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="structures">
            <Layers className="size-4" /> {t("Structures")}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileStack className="size-4" /> {t("Templates")}
          </TabsTrigger>
          <TabsTrigger value="house-rules">
            <ScrollText className="size-4" /> {t("House rules")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="structures">
          <StructuresTab />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="house-rules">
          <HouseRulesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- structures ----------------------------------------------------------------------------------------

function StructuresTab() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const structures = useStructures();
  const templates = useTemplates();
  const [newOpen, setNewOpen] = useState(false);
  const [dupOf, setDupOf] = useState<StructureSummary | null>(null);
  const [dupName, setDupName] = useState("");
  const [deleting, setDeleting] = useState<StructureSummary | null>(null);
  const manage = can("structure.manage");

  const duplicate = useMutation({
    mutationFn: (s: StructureSummary) => post<StructureSummary>(`/api/v1/structures/${s.id}/duplicate`, { name: dupName.trim() || undefined }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: cfgKeys.structures });
      setDupOf(null);
      toast.success(t("Structure duplicated"));
      router.push(`/admin/structures/${res.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (s: StructureSummary) => del(`/api/v1/structures/${s.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.structures });
      setDeleting(null);
      toast.success(t("Structure deleted"));
    },
  });
  const usedBy = (id: string) => templates.data?.filter((x) => x.structureId === id).length ?? 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("Library structures. Each tournament keeps its own copy, so edits here never change running tournaments.")}</p>
        {manage && (
          <Button onClick={() => setNewOpen(true)}>
            <Plus /> {t("New structure")}
          </Button>
        )}
      </div>
      {structures.isError && <QueryError error={structures.error} onRetry={() => void structures.refetch()} />}
      {structures.isLoading ? (
        <TableSkeleton />
      ) : (structures.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title={t("No structures yet")}
          description={t("A structure defines blind levels, antes, breaks and level durations.")}
          action={
            manage && (
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> {t("New structure")}
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("Name")}</Th>
              <Th className="text-right">{t("Levels")}</Th>
              <Th className="text-right">{t("Duration")}</Th>
              <Th className="hidden md:table-cell">{t("Used by templates")}</Th>
              <Th className="hidden md:table-cell">{t("Updated")}</Th>
              <Th className="w-0" />
            </Tr>
          </THead>
          <TBody>
            {structures.data?.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <Link href={`/admin/structures/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  {s.description && <div className="line-clamp-1 text-xs text-muted-foreground">{s.description}</div>}
                </Td>
                <Td className="text-right tabular-nums">{s.levelCount}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{formatDuration(s.totalSeconds, t)}</Td>
                <Td className="hidden tabular-nums md:table-cell">{usedBy(s.id) || "—"}</Td>
                <Td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{fmt.date(s.updatedAt)}</Td>
                <Td className="whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/structures/${s.id}`}>
                        <Pencil /> <span className="hidden sm:inline">{manage ? t("Edit") : t("Open")}</span>
                      </Link>
                    </Button>
                    {manage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label={t("More actions")}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setDupName(t("{name} (copy)", { name: s.name }));
                              duplicate.reset();
                              setDupOf(s);
                            }}
                          >
                            <Copy /> {t("Duplicate")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onSelect={() => {
                              remove.reset();
                              setDeleting(s);
                            }}
                          >
                            <Trash2 /> {t("Delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <NewStructureDialog open={newOpen} onOpenChange={setNewOpen} />
      <Dialog open={!!dupOf} onOpenChange={(o) => !o && setDupOf(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Duplicate structure")}</DialogTitle>
          </DialogHeader>
          {duplicate.isError && <Alert variant="destructive">{errorMessage(duplicate.error)}</Alert>}
          <Field label={t("Name of the copy")}>
            <Input value={dupName} onChange={(e) => setDupName(e.target.value)} maxLength={120} autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDupOf(null)}>
              {t("Cancel")}
            </Button>
            <Button loading={duplicate.isPending} onClick={() => dupOf && duplicate.mutate(dupOf)}>
              {t("Duplicate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("Delete “{name}”?", { name: deleting?.name ?? "" })}
        description={t("Structures used by a template cannot be deleted. Tournaments keep their own copies.")}
        confirmLabel={t("Delete")}
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {remove.isError && <Alert variant="destructive">{errorMessage(remove.error)}</Alert>}
      </ConfirmDialog>
    </div>
  );
}

// --- templates -------------------------------------------------------------------------------------------

function TemplatesTab() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const templates = useTemplates();
  const structures = useStructures();
  const [createFrom, setCreateFrom] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TournamentTemplate | null>(null);
  const manage = can("tournament.create");
  const remove = useMutation({
    mutationFn: (x: TournamentTemplate) => del(`/api/v1/templates/${x.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.templates });
      setDeleting(null);
      toast.success(t("Template deleted"));
    },
  });
  const structureName = (id: string) => structures.data?.find((s) => s.id === id)?.name ?? "—";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("Reusable tournament setups: create a weekly tournament in a few clicks.")}</p>
        {manage && (
          <Button asChild>
            <Link href="/admin/structures/templates/new">
              <Plus /> {t("New template")}
            </Link>
          </Button>
        )}
      </div>
      {templates.isError && <QueryError error={templates.error} onRetry={() => void templates.refetch()} />}
      {templates.isLoading ? (
        <TableSkeleton />
      ) : (templates.data ?? []).length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title={t("No templates yet")}
          description={t("Save your regular tournaments (structure, buy-in, entry options) as templates.")}
          action={
            manage && (
              <Button asChild>
                <Link href="/admin/structures/templates/new">
                  <Plus /> {t("New template")}
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("Template")}</Th>
              <Th className="hidden md:table-cell">{t("Structure")}</Th>
              <Th className="hidden sm:table-cell">{t("Buy-in")}</Th>
              <Th className="hidden text-right lg:table-cell">{t("Starting stack")}</Th>
              <Th className="w-0" />
            </Tr>
          </THead>
          <TBody>
            {templates.data?.map((x) => (
              <Tr key={x.id}>
                <Td>
                  <Link href={`/admin/structures/templates/${x.id}`} className="font-medium hover:underline">
                    {x.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {t(FORMAT_LABEL[x.config.format])} · {t(GAME_TYPE_LABEL[x.config.gameType])}
                  </div>
                </Td>
                <Td className="hidden md:table-cell">
                  <Link href={`/admin/structures/${x.structureId}`} className="hover:underline">
                    {structureName(x.structureId)}
                  </Link>
                </Td>
                <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">
                  {x.config.buyIn ? (
                    <>
                      {fmt.money(x.config.buyIn.amount, x.config.buyIn.currency)}
                      {x.config.buyIn.fee > 0 && <span className="text-muted-foreground"> + {fmt.money(x.config.buyIn.fee, x.config.buyIn.currency)}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t("Free")}</span>
                  )}
                </Td>
                <Td className="hidden text-right tabular-nums lg:table-cell">{fmt.number(x.config.startingStack)}</Td>
                <Td className="whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {manage && (
                      <Button variant="outline" size="sm" onClick={() => setCreateFrom(x.id)}>
                        <Trophy /> <span className="hidden sm:inline">{t("Create tournament")}</span>
                      </Button>
                    )}
                    <Button asChild variant="ghost" size="sm" aria-label={t("Edit")}>
                      <Link href={`/admin/structures/templates/${x.id}`}>
                        <Pencil />
                      </Link>
                    </Button>
                    {manage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        aria-label={t("Delete")}
                        onClick={() => {
                          remove.reset();
                          setDeleting(x);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <CreateFromTemplateDialog open={!!createFrom} onOpenChange={(o) => !o && setCreateFrom(null)} templateId={createFrom} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("Delete template “{name}”?", { name: deleting?.name ?? "" })}
        description={t("Tournaments created from it are not affected.")}
        confirmLabel={t("Delete")}
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        {remove.isError && <Alert variant="destructive">{errorMessage(remove.error)}</Alert>}
      </ConfirmDialog>
    </div>
  );
}

// --- house rules -------------------------------------------------------------------------------------------

function HouseRulesTab() {
  const t = useT();
  const can = useCan();
  const profiles = useHouseRules();
  const [editing, setEditing] = useState<HouseRulesProfile | null>(null);
  const [open, setOpen] = useState(false);
  const manage = can("settings.manage");
  const opt = HOUSE_RULE_OPTION_LABEL;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("How floor control seats players, balances and breaks tables.")}</p>
        {manage && (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> {t("New profile")}
          </Button>
        )}
      </div>
      {!manage && <Alert>{t("Only managers with settings access can change house rules.")}</Alert>}
      {profiles.isError && <QueryError error={profiles.error} onRetry={() => void profiles.refetch()} />}
      {profiles.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : (profiles.data ?? []).length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t("No house rules profiles")} description={t("Tournaments use the TDA 2026 style defaults.")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {profiles.data?.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div className="grid gap-1.5">
                  <CardTitle>{p.name}</CardTitle>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">{t(HOUSE_PRESET_LABEL[p.preset])}</Badge>
                    {p.isDefault && <Badge>{t("Default")}</Badge>}
                  </div>
                </div>
                {manage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(p);
                      setOpen(true);
                    }}
                  >
                    <Pencil /> {t("Edit")}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t("Initial seating")}</dt>
                  <dd>{p.config.randomInitialSeating ? t("Random") : t("Manual")}</dd>
                  <dt className="text-muted-foreground">{t("Late registrations")}</dt>
                  <dd>{t(opt.lateRegistrationSeatPolicy[p.config.lateRegistrationSeatPolicy])}</dd>
                  <dt className="text-muted-foreground">{t("Table breaking")}</dt>
                  <dd>{t(opt.tableBreakStrategy[p.config.tableBreakStrategy])}</dd>
                  <dt className="text-muted-foreground">{t("Player to move when balancing")}</dt>
                  <dd>{t(opt.balancePlayerSelection[p.config.balancePlayerSelection])}</dd>
                  <dt className="text-muted-foreground">{t("Max imbalance")}</dt>
                  <dd className="tabular-nums">
                    {p.config.maxTableImbalance}
                    {p.config.haltPlayOnSevereImbalance ? ` · ${t("halt at {n}", { n: p.config.severeImbalanceThreshold })}` : ""}
                  </dd>
                  <dt className="text-muted-foreground">{t("Final table")}</dt>
                  <dd className="tabular-nums">{p.config.finalTableSize ?? t("Table size")}</dd>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <HouseRulesDialog open={open} onOpenChange={setOpen} profile={editing} />
    </div>
  );
}
