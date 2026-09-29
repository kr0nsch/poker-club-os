"use client";

import { Alert, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Label, Select, cn } from "@pcos/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useStaff } from "@/components/staff-guard";
import { patch, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage, keys } from "@/lib/queries";
import { lbl, useSysLabels } from "./labels";
import { sysKeys } from "./queries";
import type { RoleView, StaffRow, VenueRow } from "./types";

const HIDDEN_ROLES = ["SUPER_ADMIN", "PLAYER"];

/** Create a staff account or edit roles, venue access, status and password. */
export function StaffDialog({ staff, roles, venues, onClose }: { staff: StaffRow | null; roles: RoleView[]; venues: VenueRow[]; onClose(): void }) {
  const t = useT();
  const L = useSysLabels();
  const me = useStaff();
  const qc = useQueryClient();
  const editing = !!staff;
  const self = editing && staff.id === me.user?.id;
  const canGrantOwner = !!me.user?.isSuperAdmin || me.roles.includes("ORGANIZATION_OWNER");
  const initialRoles = (staff?.roles ?? []).filter((r) => r !== "PLAYER");

  const [email, setEmail] = useState(staff?.email ?? "");
  const [displayName, setDisplayName] = useState(staff?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<string[]>(initialRoles);
  const [venueMode, setVenueMode] = useState<"all" | "some">(staff?.venueIds ? "some" : "all");
  const [venueIds, setVenueIds] = useState<string[]>(staff?.venueIds ?? []);
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">(staff?.memberStatus === "DISABLED" ? "DISABLED" : "ACTIVE");

  const assignable = roles.filter((r) => !HIDDEN_ROLES.includes(r.key));
  const nextVenues = venueMode === "all" ? null : venueIds;
  const sameList = (a: readonly string[] | null, b: readonly string[] | null) => (a === null || b === null ? a === b : a.length === b.length && [...a].sort().join() === [...b].sort().join());
  const rolesChanged = !sameList(selected, initialRoles);
  const venuesChanged = !sameList(nextVenues, staff?.venueIds ?? null);
  const statusChanged = editing && status !== (staff.memberStatus === "DISABLED" ? "DISABLED" : "ACTIVE");
  const nameChanged = editing && displayName.trim() !== staff.displayName;
  const signsOut = editing && (rolesChanged || statusChanged || password.length > 0);

  const errors = {
    email: !editing && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? t("Enter a valid email address.") : null,
    password: password && password.length < 10 ? t("At least 10 characters") : null,
    roles: selected.length === 0 ? t("Choose at least one role.") : selected.length > 10 ? t("At most 10 roles.") : null,
    venues: venueMode === "some" && venueIds.length === 0 ? t("Choose at least one venue.") : null,
  };
  const valid = editing
    ? !errors.password && !errors.roles && !errors.venues && displayName.trim().length > 0
    : !!email.trim() && !errors.email && displayName.trim().length > 0 && password.length >= 10 && !errors.roles && !errors.venues;
  const dirty = !editing || rolesChanged || venuesChanged || statusChanged || nameChanged || password.length > 0;

  const save = useMutation({
    mutationFn: () => {
      if (!staff) {
        return post("/api/v1/staff", { email: email.trim(), displayName: displayName.trim(), password, roles: selected, venueIds: nextVenues });
      }
      const body: Record<string, unknown> = {};
      if (nameChanged) body.displayName = displayName.trim();
      if (rolesChanged) body.roles = selected;
      if (venuesChanged) body.venueIds = nextVenues;
      if (statusChanged) body.status = status;
      if (password) body.password = password;
      return patch(`/api/v1/staff/${staff.id}`, body);
    },
    onSuccess: () => {
      toast.success(editing ? t("Staff member updated") : t("Staff member added"));
      void qc.invalidateQueries({ queryKey: sysKeys.staff });
      if (self) void qc.invalidateQueries({ queryKey: keys.me });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggleRole = (key: string, on: boolean) => setSelected((prev) => (on ? [...new Set([...prev, key])] : prev.filter((r) => r !== key)));
  const toggleVenue = (id: string, on: boolean) => setVenueIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((v) => v !== id)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit staff member") : t("Add staff member")}</DialogTitle>
          <DialogDescription>{editing ? staff.email : t("The new account can sign in on any staff device right away.")}</DialogDescription>
        </DialogHeader>
        <form
          id="staff-form"
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && dirty) save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!editing && (
              <Field label={t("Email")} error={errors.email}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoFocus />
              </Field>
            )}
            <Field label={t("Name")}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} autoComplete="off" />
            </Field>
            <Field label={editing ? t("New password") : t("Password")} error={errors.password} hint={editing ? t("Leave empty to keep the current password.") : t("At least 10 characters")}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            {editing && (
              <Field label={t("Status")} hint={self ? t("You cannot disable your own account.") : undefined}>
                <Select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "DISABLED")} disabled={self}>
                  <option value="ACTIVE">{t("Active")}</option>
                  <option value="DISABLED">{t("Disabled (cannot sign in)")}</option>
                </Select>
              </Field>
            )}
          </div>

          <div className="grid gap-2">
            <Label>{t("Roles")}</Label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {assignable.map((r) => {
                const locked = r.key === "ORGANIZATION_OWNER" && !canGrantOwner;
                const on = selected.includes(r.key);
                return (
                  <label
                    key={r.key}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition-colors",
                      on ? "border-primary/50 bg-primary/10" : "border-border hover:bg-accent",
                      locked && "cursor-not-allowed opacity-50",
                    )}
                    title={locked ? t("Only an owner can grant the owner role") : undefined}
                  >
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={on} disabled={locked} onChange={(e) => toggleRole(r.key, e.target.checked)} />
                    <span className="min-w-0">
                      <span className="block font-medium">{r.isSystem ? lbl(L.role, r.key) : r.name}</span>
                      <span className="block text-xs text-muted-foreground">{t("Permissions: {n}", { n: r.permissions.length })}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.roles && <p className="text-xs text-destructive">{errors.roles}</p>}
          </div>

          <div className="grid gap-2">
            <Label>{t("Venue access")}</Label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="venue-mode" className="accent-[var(--primary)]" checked={venueMode === "all"} onChange={() => setVenueMode("all")} />
                {t("All venues")}
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="venue-mode" className="accent-[var(--primary)]" checked={venueMode === "some"} onChange={() => setVenueMode("some")} />
                {t("Selected venues only")}
              </label>
            </div>
            {venueMode === "some" && (
              <div className="grid gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-2">
                {venues.map((v) => (
                  <Checkbox key={v.id} checked={venueIds.includes(v.id)} onChange={(e) => toggleVenue(v.id, e.target.checked)} label={v.name} />
                ))}
                {venues.length === 0 && <p className="text-sm text-muted-foreground">{t("No venues yet.")}</p>}
              </div>
            )}
            {errors.venues && <p className="text-xs text-destructive">{errors.venues}</p>}
          </div>

          {signsOut && (
            <Alert variant="warning">
              {self
                ? t("You are changing your own roles, status or password: you will be signed out on all devices, including this one.")
                : t("Changing roles, status or password signs this person out on all devices.")}
            </Alert>
          )}
          {!editing && <p className="text-xs text-muted-foreground">{t("If this email already has a player account, that account becomes a staff member and keeps its existing password.")}</p>}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" form="staff-form" disabled={!valid || !dirty} loading={save.isPending}>
            {editing ? t("Save") : t("Add staff member")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
