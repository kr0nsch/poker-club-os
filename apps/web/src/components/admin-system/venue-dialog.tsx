"use client";

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input } from "@pcos/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { patch, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { sysKeys } from "./queries";
import type { VenueRow } from "./types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);

function validUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** IANA time zones for <datalist> suggestions. */
export function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Europe/Berlin", "Europe/Moscow", "Europe/London", "UTC"];
  }
}

export function isTimeZone(v: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

export function VenueDialog({ venue, defaultTimezone, onClose }: { venue: VenueRow | null; defaultTimezone: string; onClose(): void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(venue?.name ?? "");
  const [slug, setSlug] = useState(venue?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!venue);
  const [timezone, setTimezone] = useState(venue?.timezone ?? defaultTimezone);
  const [address, setAddress] = useState(venue?.address ?? "");
  const [localHostname, setLocalHostname] = useState(venue?.localHostname ?? "");
  const [localUrl, setLocalUrl] = useState(venue?.localUrl ?? "");
  const [publicUrl, setPublicUrl] = useState(venue?.publicUrl ?? "");

  const errors = {
    slug: slug && !SLUG.test(slug) ? t("Lowercase letters, digits and dashes only.") : null,
    timezone: timezone && !isTimeZone(timezone) ? t("Unknown time zone.") : null,
    localHostname: localHostname.trim() && !HOSTNAME.test(localHostname.trim()) ? t("A host name such as poker.club.example, without https://") : null,
    localUrl: localUrl.trim() && !validUrl(localUrl.trim()) ? t("Full address starting with https://") : null,
    publicUrl: publicUrl.trim() && !validUrl(publicUrl.trim()) ? t("Full address starting with https://") : null,
  };
  const valid = name.trim().length > 0 && slug.length >= 2 && !Object.values(errors).some(Boolean) && !!timezone;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        slug,
        timezone,
        address: address.trim() || null,
        localHostname: localHostname.trim().toLowerCase() || null,
        localUrl: localUrl.trim().replace(/\/$/, "") || null,
        publicUrl: publicUrl.trim().replace(/\/$/, "") || null,
      };
      return venue ? patch<VenueRow>(`/api/v1/venues/${venue.id}`, body) : post<VenueRow>("/api/v1/venues", body);
    },
    onSuccess: () => {
      toast.success(venue ? t("Venue saved") : t("Venue created"));
      void qc.invalidateQueries({ queryKey: sysKeys.venues });
      void qc.invalidateQueries({ queryKey: sysKeys.network });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{venue ? t("Edit venue") : t("New venue")}</DialogTitle>
          <DialogDescription>{t("A room or location where tournaments take place.")}</DialogDescription>
        </DialogHeader>
        <form
          id="venue-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <Field label={t("Venue name")}>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              maxLength={120}
              autoFocus
            />
          </Field>
          <Field label={t("Short address (slug)")} error={errors.slug}>
            <Input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              maxLength={64}
              className="font-mono"
            />
          </Field>
          <Field label={t("Time zone")} error={errors.timezone}>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value.trim())} list="sys-timezones" />
          </Field>
          <Field label={t("Address")}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
          </Field>
          <Field
            className="sm:col-span-2"
            label={t("Local hostname")}
            error={errors.localHostname}
            hint={t("Name staff devices use on the venue network, e.g. poker.royalclub.example (local DNS → this server)")}
          >
            <Input value={localHostname} onChange={(e) => setLocalHostname(e.target.value)} placeholder="poker.club.example" className="font-mono" />
          </Field>
          <Field label={t("Local address (URL)")} error={errors.localUrl} hint={t("Optional. Defaults to https:// plus the local hostname; used in QR codes and display links.")}>
            <Input value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="https://poker.club.example" className="font-mono" />
          </Field>
          <Field label={t("Public address (URL)")} error={errors.publicUrl} hint={t("Optional. Cloud address for players outside the venue.")}>
            <Input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://club.example" className="font-mono" />
          </Field>
          <datalist id="sys-timezones">
            {timeZones().map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" form="venue-form" disabled={!valid} loading={save.isPending}>
            {venue ? t("Save") : t("Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
