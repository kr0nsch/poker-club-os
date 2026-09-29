"use client";

import { Alert, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select } from "@pcos/ui";
import type { PlayerStatus } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { cfgKeys, usePlayerTags } from "./queries";
import type { PlayerDetail, PlayerSummary } from "./types";

type T = (text: string, vars?: Record<string, string | number | null | undefined>) => string;

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "de", label: "Deutsch" },
  { code: "uk", label: "Українська" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pl", label: "Polski" },
];

export interface PlayerForm {
  firstName: string;
  lastName: string;
  displayName: string;
  nickname: string;
  email: string;
  phone: string;
  memberNumber: string;
  language: string;
  country: string;
  dateOfBirth: string;
  status: PlayerStatus;
  marketingConsent: boolean;
  publicProfileEnabled: boolean;
}

export const PLAYER_FIELDS = ["firstName", "lastName", "displayName", "nickname", "email", "phone", "memberNumber", "language", "country", "dateOfBirth", "status", "marketingConsent", "publicProfileEnabled"] as const;
export type PlayerField = (typeof PLAYER_FIELDS)[number];

export const emptyPlayerForm = (): PlayerForm => ({
  firstName: "",
  lastName: "",
  displayName: "",
  nickname: "",
  email: "",
  phone: "",
  memberNumber: "",
  language: "",
  country: "",
  dateOfBirth: "",
  status: "ACTIVE",
  marketingConsent: false,
  publicProfileEnabled: false,
});

export function playerFormFrom(p: PlayerDetail): PlayerForm {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    displayName: p.displayName,
    nickname: p.nickname ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    memberNumber: p.memberNumber ?? "",
    language: p.language ?? "",
    country: p.country ?? "",
    dateOfBirth: p.dateOfBirth ?? "",
    status: p.status,
    marketingConsent: p.marketingConsent,
    publicProfileEnabled: p.publicProfileEnabled,
  };
}

/** Validates and converts to API values (empty optional fields → null). */
export function playerValues(f: PlayerForm, t: T, opts: { requireDisplayName?: boolean } = {}): { values: Record<PlayerField, unknown>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const trimmed = (s: string) => s.trim() || null;
  if (!f.firstName.trim()) errors.firstName = t("Required");
  if (!f.lastName.trim()) errors.lastName = t("Required");
  if (opts.requireDisplayName && !f.displayName.trim()) errors.displayName = t("Required");
  const email = f.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = t("Enter a valid email address");
  const phone = f.phone.trim();
  if (phone && !/^[+0-9 ()-]*$/.test(phone)) errors.phone = t("Digits, spaces, +, -, ( ) only");
  const country = f.country.trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) errors.country = t("Two-letter country code, e.g. DE");
  if (f.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(f.dateOfBirth)) errors.dateOfBirth = t("Enter a valid date");
  return {
    values: {
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      displayName: trimmed(f.displayName),
      nickname: trimmed(f.nickname),
      email: email ? email.toLowerCase() : null,
      phone: phone || null,
      memberNumber: trimmed(f.memberNumber),
      language: f.language || null,
      country: country || null,
      dateOfBirth: f.dateOfBirth || null,
      status: f.status,
      marketingConsent: f.marketingConsent,
      publicProfileEnabled: f.publicProfileEnabled,
    },
    errors,
  };
}

/** Personal data fields shared by the "New player" dialog and the profile editor. */
export function PlayerFields({ form, set, errors, disabled, extra }: { form: PlayerForm; set: <K extends keyof PlayerForm>(k: K, v: PlayerForm[K]) => void; errors: Record<string, string>; disabled?: boolean; extra?: ReactNode }) {
  const t = useT();
  const suggestedName = form.nickname.trim() || (form.firstName.trim() && form.lastName.trim() ? `${form.firstName.trim()} ${form.lastName.trim().charAt(0)}.` : "");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("First name")} error={errors.firstName}>
        <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} maxLength={80} disabled={disabled} aria-invalid={!!errors.firstName || undefined} autoComplete="off" />
      </Field>
      <Field label={t("Last name")} error={errors.lastName}>
        <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} maxLength={80} disabled={disabled} aria-invalid={!!errors.lastName || undefined} autoComplete="off" />
      </Field>
      <Field label={t("Nickname")}>
        <Input value={form.nickname} onChange={(e) => set("nickname", e.target.value)} maxLength={40} disabled={disabled} />
      </Field>
      <Field label={t("Display name")} error={errors.displayName} hint={t("Shown on screens, seat lists and leaderboards.")}>
        <Input value={form.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={80} disabled={disabled} placeholder={suggestedName} aria-invalid={!!errors.displayName || undefined} />
      </Field>
      <Field label={t("Email")} error={errors.email}>
        <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={254} disabled={disabled} aria-invalid={!!errors.email || undefined} autoComplete="off" />
      </Field>
      <Field label={t("Phone")} error={errors.phone}>
        <Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={32} disabled={disabled} aria-invalid={!!errors.phone || undefined} autoComplete="off" />
      </Field>
      <Field label={t("Member number")} error={errors.memberNumber} hint={t("Club card number; needed for kiosk PIN check-in.")}>
        <Input value={form.memberNumber} onChange={(e) => set("memberNumber", e.target.value)} maxLength={32} disabled={disabled} className="font-mono" />
      </Field>
      <Field label={t("Date of birth")} error={errors.dateOfBirth}>
        <Input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} disabled={disabled} />
      </Field>
      <Field label={t("Language")}>
        <Select value={form.language} onChange={(e) => set("language", e.target.value)} disabled={disabled}>
          <option value="">{t("Not set")}</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
          {form.language && !LANGUAGES.some((l) => l.code === form.language) && <option value={form.language}>{form.language}</option>}
        </Select>
      </Field>
      <Field label={t("Country")} error={errors.country} hint={t("Two-letter code, e.g. DE")}>
        <Input value={form.country} onChange={(e) => set("country", e.target.value.toUpperCase())} maxLength={2} disabled={disabled} className="font-mono uppercase" aria-invalid={!!errors.country || undefined} />
      </Field>
      {extra}
      <div className="grid gap-2 sm:col-span-2">
        <Checkbox label={t("Agrees to marketing messages")} checked={form.marketingConsent} onChange={(e) => set("marketingConsent", e.target.checked)} disabled={disabled} />
        <Checkbox label={t("Public profile (name on public leaderboards)")} checked={form.publicProfileEnabled} onChange={(e) => set("publicProfileEnabled", e.target.checked)} disabled={disabled} />
      </div>
    </div>
  );
}

/** "New player" dialog (POST /players). */
export function NewPlayerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (p: PlayerSummary) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>{open && <NewPlayerForm onCreated={onCreated} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function NewPlayerForm({ onCreated, onClose }: { onCreated: (p: PlayerSummary) => void; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const tags = usePlayerTags();
  const [form, setForm] = useState<PlayerForm>(emptyPlayerForm);
  const [tagText, setTagText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof PlayerForm>(k: K, v: PlayerForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<PlayerSummary>("/api/v1/players", body),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: cfgKeys.players });
      void qc.invalidateQueries({ queryKey: cfgKeys.playerTags });
      toast.success(t("Player {name} created", { name: p.displayName }));
      onClose();
      onCreated(p);
    },
  });

  function submit() {
    const { values, errors: errs } = playerValues(form, t);
    const tagList = [...new Set(tagText.split(/[,;]/).map((x) => x.trim()).filter(Boolean))];
    if (tagList.length > 20 || tagList.some((x) => x.length > 40)) errs.tags = t("Up to 20 tags, 40 characters each");
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const { status: _status, ...body } = values;
    create.mutate({ ...body, source: "STAFF", tags: tagList.length ? tagList : undefined });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("New player")}</DialogTitle>
        <DialogDescription>{t("Only first and last name are required. Email, phone and member number must be unique.")}</DialogDescription>
      </DialogHeader>
      {create.isError && <Alert variant="destructive">{errorMessage(create.error)}</Alert>}
      <PlayerFields
        form={form}
        set={set}
        errors={errors}
        extra={
          <Field label={t("Tags")} error={errors.tags} hint={t("Separate with commas")} className="sm:col-span-2">
            <Input value={tagText} onChange={(e) => setTagText(e.target.value)} list="pcos-new-player-tags" placeholder={tags.data?.slice(0, 3).map((x) => x.name).join(", ")} />
            <datalist id="pcos-new-player-tags">
              {tags.data?.map((x) => (
                <option key={x.id} value={x.name} />
              ))}
            </datalist>
          </Field>
        }
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button loading={create.isPending} onClick={submit}>
          {t("Create player")}
        </Button>
      </DialogFooter>
    </>
  );
}
