"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, PageHeader, Table, TBody, Td, Th, THead, Tr, cn } from "@pcos/ui";
import { Check, ChevronDown, Pencil, Plus, Search, ShieldCheck, UsersRound } from "lucide-react";
import { Fragment, useState } from "react";
import { lbl, useSysLabels } from "@/components/admin-system/labels";
import { useRoles, useStaffList, useVenues } from "@/components/admin-system/queries";
import { StaffDialog } from "@/components/admin-system/staff-dialog";
import type { RoleView, StaffRow } from "@/components/admin-system/types";
import { ErrorState, NoAccess, RowsSkeleton } from "@/components/admin-system/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { useFormat, useT } from "@/lib/i18n";

/** Staff accounts, roles and venue access (spec §34-36). */
export default function StaffPage() {
  const t = useT();
  const can = useCan();
  const manage = can("staff.manage");
  const [dialog, setDialog] = useState<StaffRow | "new" | null>(null);
  const staff = useStaffList(manage);
  const roles = useRoles(manage);
  const venues = useVenues(manage);

  return (
    <div className="grid gap-6">
      <PageHeader
        className="mb-0"
        title={t("Staff")}
        description={t("Staff accounts, their roles and which venues they can work in.")}
        actions={
          manage && (
            <Button onClick={() => setDialog("new")} disabled={!roles.data}>
              <Plus /> {t("Add staff member")}
            </Button>
          )
        }
      />
      {!manage ? (
        <NoAccess permission="staff.manage" />
      ) : (
        <>
          <StaffTable staff={staff.data} loading={staff.isLoading} error={staff.error} onRetry={() => void staff.refetch()} venueName={(id) => venues.data?.find((v) => v.id === id)?.name ?? id.slice(0, 8)} onEdit={(s) => setDialog(s)} />
          {roles.data && <RolesMatrix roles={roles.data.roles} permissions={roles.data.permissions} />}
          {roles.error && <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />}
        </>
      )}
      {dialog && roles.data && <StaffDialog staff={dialog === "new" ? null : dialog} roles={roles.data.roles} venues={venues.data ?? []} onClose={() => setDialog(null)} />}
    </div>
  );
}

function StaffTable({
  staff,
  loading,
  error,
  onRetry,
  venueName,
  onEdit,
}: {
  staff?: StaffRow[];
  loading: boolean;
  error: unknown;
  onRetry(): void;
  venueName(id: string): string;
  onEdit(s: StaffRow): void;
}) {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const me = useStaff();
  const [query, setQuery] = useState("");
  const isOwner = !!me.user?.isSuperAdmin || me.roles.includes("ORGANIZATION_OWNER");

  if (loading) return <RowsSkeleton rows={5} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  const all = staff ?? [];
  if (all.length === 0) return <EmptyState icon={<UsersRound />} title={t("No staff yet")} />;
  const q = query.trim().toLowerCase();
  const rows = all.filter((s) => !q || [s.displayName, s.email, ...s.roles.map((r) => lbl(L.role, r))].some((v) => v.toLowerCase().includes(q)));

  return (
    <div className="grid gap-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search by name, email or role")} className="pl-9" />
      </div>
      <Table>
        <THead>
          <Tr>
            <Th>{t("Name")}</Th>
            <Th>{t("Roles")}</Th>
            <Th>{t("Venues")}</Th>
            <Th>{t("Status")}</Th>
            <Th>{t("Last sign-in")}</Th>
            <Th className="text-right">
              <span className="sr-only">{t("Actions")}</span>
            </Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((s) => {
            const disabled = s.memberStatus === "DISABLED" || s.status !== "ACTIVE";
            const ownerLocked = s.roles.includes("ORGANIZATION_OWNER") && !isOwner;
            return (
              <Tr key={s.id} className={cn(disabled && "opacity-60")}>
                <Td>
                  <div className="flex items-center gap-2 font-medium">
                    {s.displayName}
                    {s.id === me.user?.id && <Badge variant="default">{t("You")}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </Td>
                <Td>
                  <div className="flex max-w-80 flex-wrap gap-1">
                    {s.roles
                      .filter((r) => r !== "PLAYER")
                      .map((r) => (
                        <Badge key={r} variant={r === "ORGANIZATION_OWNER" ? "warning" : "secondary"}>
                          {lbl(L.role, r)}
                        </Badge>
                      ))}
                  </div>
                </Td>
                <Td className="text-sm">{s.venueIds ? s.venueIds.map(venueName).join(", ") : <span className="text-muted-foreground">{t("All venues")}</span>}</Td>
                <Td>{disabled ? <Badge variant="destructive">{t("Disabled")}</Badge> : <Badge variant="success">{t("Active")}</Badge>}</Td>
                <Td className="whitespace-nowrap text-muted-foreground" title={fmt.dateTime(s.lastLoginAt)}>
                  {s.lastLoginAt ? fmt.relative(s.lastLoginAt) : t("Never")}
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => onEdit(s)} disabled={ownerLocked} title={ownerLocked ? t("Only an owner can modify another owner") : undefined}>
                    <Pencil /> {t("Edit")}
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

/** Role → permission matrix, grouped by permission area. */
function RolesMatrix({ roles, permissions }: { roles: RoleView[]; permissions: string[] }) {
  const t = useT();
  const L = useSysLabels();
  const [open, setOpen] = useState(false);
  const columns = roles.filter((r) => r.key !== "PLAYER" && r.key !== "SUPER_ADMIN");
  const groups = new Map<string, string[]>();
  for (const p of permissions) {
    const g = p.split(".")[0] ?? p;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const has = (r: RoleView, p: string) => r.permissions.includes(p);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> {t("Roles and permissions")}
          </CardTitle>
          <CardDescription>{t("System roles are predefined. A person with several roles gets all of their permissions.")}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          {open ? t("Hide matrix") : t("Show matrix")}
        </Button>
      </CardHeader>
      <CardContent>
        {!open ? (
          <div className="flex flex-wrap gap-2">
            {columns.map((r) => (
              <Badge key={r.key} variant="outline" className="gap-1.5 py-1">
                {r.isSystem ? lbl(L.role, r.key) : r.name}
                <span className="text-muted-foreground tabular-nums">{r.permissions.length}</span>
              </Badge>
            ))}
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-20 bg-card px-3 py-2 text-left font-medium text-muted-foreground">{t("Permission")}</th>
                  {columns.map((r) => (
                    <th key={r.key} className="min-w-20 px-2 py-2 text-center align-bottom font-medium">
                      <span className="block leading-tight">{r.isSystem ? lbl(L.role, r.key) : r.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...groups.entries()].map(([group, perms]) => (
                  <Fragment key={group}>
                    <tr className="bg-muted/40">
                      <td colSpan={columns.length + 1} className="sticky left-0 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                        {lbl(L.permissionGroup, group)}
                      </td>
                    </tr>
                    {perms.map((p) => (
                      <tr key={p} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="sticky left-0 bg-card px-3 py-1.5 font-mono whitespace-nowrap">{p}</td>
                        {columns.map((r) => (
                          <td key={r.key} className="px-2 py-1.5 text-center">
                            {has(r, p) ? <Check className="mx-auto size-3.5 text-success" aria-label={t("Yes")} /> : <span className="text-muted-foreground/40">·</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
