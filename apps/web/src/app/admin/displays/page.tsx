"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  PageHeader,
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
  cn,
} from "@pcos/ui";
import type { DisplayTokenKind } from "@pcos/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, MonitorPlay, Pencil, Plus, TabletSmartphone, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CreateTokenDialog, TemplateDialog, TemplatePreview } from "@/components/admin-system/display-dialogs";
import { useSysLabels } from "@/components/admin-system/labels";
import { sysKeys, useTournamentOptions, useVenues } from "@/components/admin-system/queries";
import type { DisplayTemplateRow, DisplayTokenRow } from "@/components/admin-system/types";
import { ErrorState, LiveDot, NoAccess, RowsSkeleton, useConfirm } from "@/components/admin-system/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { del, get, post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { useServerNow } from "@/lib/realtime-context";

type Tab = "displays" | "kiosks" | "templates";

/** Displays & kiosks (spec §46, §52): secret device links and display templates. */
export default function DisplaysPage() {
  const t = useT();
  const can = useCan();
  const me = useStaff();
  const manage = can("display.manage");
  const [tab, setTab] = useState<Tab>("displays");
  const [creating, setCreating] = useState<DisplayTokenKind | null>(null);
  const [editing, setEditing] = useState<DisplayTemplateRow | "new" | null>(null);
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();

  const tokens = useQuery({ queryKey: sysKeys.displayTokens, queryFn: () => get<DisplayTokenRow[]>("/api/v1/display-tokens"), enabled: manage, refetchInterval: 30_000 });
  const templates = useQuery({ queryKey: sysKeys.displayTemplates, queryFn: () => get<DisplayTemplateRow[]>("/api/v1/display-templates") });
  const venues = useVenues();
  const tournaments = useTournamentOptions();
  const allowedVenues = (venues.data ?? []).filter((v) => !me.venueIds || me.venueIds.includes(v.id));

  const removeTemplate = (tpl: DisplayTemplateRow, usedBy: number) =>
    confirm({
      title: t("Delete template “{name}”?", { name: tpl.name }),
      description: usedBy > 0 ? t("{n} displays use this template. They switch to the organization default layout.", { n: usedBy }) : t("No display uses this template."),
      confirmLabel: t("Delete"),
      action: async () => {
        await del(`/api/v1/display-templates/${tpl.id}`);
        toast.success(t("Template deleted"));
        await Promise.all([qc.invalidateQueries({ queryKey: sysKeys.displayTemplates }), qc.invalidateQueries({ queryKey: sysKeys.displayTokens })]);
      },
    });

  const counts = useMemo(() => {
    const active = (tokens.data ?? []).filter((x) => !x.revoked);
    return { displays: active.filter((x) => x.kind === "DISPLAY").length, kiosks: active.filter((x) => x.kind === "KIOSK").length };
  }, [tokens.data]);

  const action =
    !manage ? null : tab === "templates" ? (
      <Button onClick={() => setEditing("new")}>
        <Plus /> {t("New template")}
      </Button>
    ) : (
      <Button onClick={() => setCreating(tab === "kiosks" ? "KIOSK" : "DISPLAY")}>
        <Plus /> {tab === "kiosks" ? t("New kiosk link") : t("New display link")}
      </Button>
    );

  return (
    <div>
      <PageHeader
        title={t("Displays & kiosks")}
        description={t("TV displays show public tournament data; kiosks let players check in themselves. Each device opens its own secret link, no sign-in needed.")}
        actions={action}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="displays">
            <MonitorPlay className="size-4" /> {t("Displays")}
            {tokens.data && <span className="text-xs text-muted-foreground tabular-nums">{counts.displays}</span>}
          </TabsTrigger>
          <TabsTrigger value="kiosks">
            <TabletSmartphone className="size-4" /> {t("Kiosks")}
            {tokens.data && <span className="text-xs text-muted-foreground tabular-nums">{counts.kiosks}</span>}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <LayoutTemplate className="size-4" /> {t("Templates")}
          </TabsTrigger>
        </TabsList>

        {(["displays", "kiosks"] as const).map((k) => (
          <TabsContent key={k} value={k}>
            {!manage ? (
              <NoAccess permission="display.manage" />
            ) : tokens.isLoading ? (
              <RowsSkeleton />
            ) : tokens.error ? (
              <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
            ) : (
              <TokenTable
                kind={k === "kiosks" ? "KIOSK" : "DISPLAY"}
                rows={tokens.data ?? []}
                templates={templates.data ?? []}
                onCreate={() => setCreating(k === "kiosks" ? "KIOSK" : "DISPLAY")}
                venueName={(id) => venues.data?.find((v) => v.id === id)?.name ?? "—"}
                tournamentName={(id) => tournaments.data?.find((x) => x.id === id)?.name ?? null}
              />
            )}
          </TabsContent>
        ))}

        <TabsContent value="templates">
          {templates.isLoading ? (
            <RowsSkeleton />
          ) : templates.error ? (
            <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
          ) : (templates.data ?? []).length === 0 ? (
            <EmptyState
              icon={<LayoutTemplate />}
              title={t("No display templates yet")}
              description={t("Displays use a built-in layout until you create a template.")}
              action={
                manage && (
                  <Button onClick={() => setEditing("new")}>
                    <Plus /> {t("New template")}
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(templates.data ?? []).map((tpl, i) => {
                const usedBy = (tokens.data ?? []).filter((x) => !x.revoked && x.displayTemplateId === tpl.id).length;
                return (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    isDefault={i === defaultTemplateIndex(templates.data ?? [])}
                    usedBy={usedBy}
                    onEdit={manage ? () => setEditing(tpl) : undefined}
                    onDelete={manage ? () => removeTemplate(tpl, usedBy) : undefined}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {creating && (
        <CreateTokenDialog kind={creating} venues={allowedVenues} tournaments={tournaments.data ?? []} templates={templates.data ?? []} onClose={() => setCreating(null)} />
      )}
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {dialog}
    </div>
  );
}

/** Displays without a template use the organization's oldest template. */
function defaultTemplateIndex(list: DisplayTemplateRow[]) {
  let best = -1;
  list.forEach((x, i) => {
    if (best < 0 || x.createdAt < list[best]!.createdAt) best = i;
  });
  return best;
}

function TokenTable({
  kind,
  rows,
  templates,
  onCreate,
  venueName,
  tournamentName,
}: {
  kind: DisplayTokenKind;
  rows: DisplayTokenRow[];
  templates: DisplayTemplateRow[];
  onCreate(): void;
  venueName(id: string): string;
  tournamentName(id: string): string | null;
}) {
  const t = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const now = useServerNow(30_000);
  const { confirm, dialog } = useConfirm();
  const [showRevoked, setShowRevoked] = useState(false);
  const all = rows.filter((x) => x.kind === kind);
  const revokedCount = all.filter((x) => x.revoked).length;
  const list = all.filter((x) => showRevoked || !x.revoked).sort((a, b) => Number(a.revoked) - Number(b.revoked));
  const isDisplay = kind === "DISPLAY";

  const revoke = (row: DisplayTokenRow) =>
    confirm({
      title: t("Revoke “{name}”?", { name: row.name }),
      description: t("The device using this link stops receiving data immediately. This cannot be undone: create a new link to reconnect it."),
      confirmLabel: t("Revoke"),
      action: async () => {
        await post(`/api/v1/display-tokens/${row.id}/revoke`);
        toast.success(t("Link revoked"));
        await qc.invalidateQueries({ queryKey: sysKeys.displayTokens });
      },
    });

  if (all.length === 0) {
    return (
      <EmptyState
        icon={isDisplay ? <MonitorPlay /> : <TabletSmartphone />}
        title={isDisplay ? t("No display links yet") : t("No kiosk links yet")}
        description={isDisplay ? t("Create a link and open it in the TV's browser. The screen follows the venue's current tournament automatically.") : t("Create a link and open it on a tablet at the entrance so players can check in themselves.")}
        action={
          <Button onClick={onCreate}>
            <Plus /> {isDisplay ? t("New display link") : t("New kiosk link")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-3">
      {revokedCount > 0 && (
        <Checkbox checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} label={t("Show revoked ({n})", { n: revokedCount })} className="justify-self-end text-muted-foreground" />
      )}
      <Table>
        <THead>
          <Tr>
            <Th>{t("Name")}</Th>
            <Th>{t("Venue")}</Th>
            <Th>{t("Shows")}</Th>
            {isDisplay && <Th>{t("Template")}</Th>}
            <Th>{t("Last seen")}</Th>
            <Th>{t("Created")}</Th>
            <Th>{t("Status")}</Th>
            <Th className="text-right">{t("Actions")}</Th>
          </Tr>
        </THead>
        <TBody>
          {list.map((row) => {
            const seen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : null;
            const recent = seen != null && now - seen < 3 * 60_000;
            const tpl = templates.find((x) => x.id === row.displayTemplateId);
            return (
              <Tr key={row.id} className={cn(row.revoked && "opacity-55")}>
                <Td>
                  <div className="font-medium">{row.name}</div>
                  <code className="text-xs text-muted-foreground">{row.tokenPrefix}…</code>
                </Td>
                <Td>{venueName(row.venueId)}</Td>
                <Td className="max-w-64">
                  {row.tournamentId ? (
                    <span className="line-clamp-2">{tournamentName(row.tournamentId) ?? t("Tournament {id}", { id: row.tournamentId.slice(0, 8) })}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("Follows the venue's current tournament")}</span>
                  )}
                </Td>
                {isDisplay && <Td>{tpl ? tpl.name : <span className="text-muted-foreground">{t("Organization default")}</span>}</Td>}
                <Td className="whitespace-nowrap">
                  {row.lastSeenAt ? (
                    <span className="inline-flex items-center gap-2" title={fmt.dateTime(row.lastSeenAt)}>
                      <LiveDot on={recent && !row.revoked} />
                      {fmt.relative(row.lastSeenAt)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t("Never")}</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{fmt.date(row.createdAt)}</Td>
                <Td>{row.revoked ? <Badge variant="destructive">{t("Revoked")}</Badge> : <Badge variant="success">{t("Active")}</Badge>}</Td>
                <Td className="text-right">
                  {!row.revoked && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => revoke(row)}>
                      {t("Revoke")}
                    </Button>
                  )}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t("Links are secret and shown only when created. Lost a link? Revoke it and create a new one.")}</p>
      {dialog}
    </div>
  );
}

function TemplateCard({
  template,
  isDefault,
  usedBy,
  onEdit,
  onDelete,
}: {
  template: DisplayTemplateRow;
  isDefault: boolean;
  usedBy: number;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const L = useSysLabels();
  const theme = template.theme ?? {};
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="truncate">{template.name}</CardTitle>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {isDefault && <Badge variant="default">{t("Organization default")}</Badge>}
            <span>{t("Used by {n} displays", { n: usedBy })}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil /> {t("Edit")}
            </Button>
          )}
          {onDelete && (
            <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" onClick={onDelete} aria-label={t("Delete")}>
              <Trash2 />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <TemplatePreview compact widgets={template.widgets} accent={theme.accent ?? "#ededef"} background={theme.background ?? "#08090a"} sponsorText={theme.sponsorText} />
        <div className="flex flex-wrap gap-1">
          {template.widgets.map((w) => (
            <Badge key={w} variant="secondary">
              {L.widget[w] ?? w}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="mt-auto gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border" style={{ background: theme.accent ?? "#ededef" }} /> {t("Accent")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border" style={{ background: theme.background ?? "#08090a" }} /> {t("Background")}
        </span>
        {theme.sponsorText && <span className="truncate">“{theme.sponsorText}”</span>}
      </CardFooter>
    </Card>
  );
}
