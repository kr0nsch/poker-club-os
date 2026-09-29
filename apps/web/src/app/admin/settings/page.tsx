"use client";

import { Alert, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Select, Switch, Table, TBody, Td, Th, THead, Tr, cn } from "@pcos/ui";
import { FEATURE_FLAGS, NOTIFICATION_TYPES, type FeatureFlag, type NotificationType } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BellRing, Building2, MapPin, Pencil, Plus, ToggleRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSysLabels } from "@/components/admin-system/labels";
import { sysKeys, useOrganization, useVenues } from "@/components/admin-system/queries";
import type { OrganizationView, VenueRow } from "@/components/admin-system/types";
import { ErrorState, RowsSkeleton, useConfirm } from "@/components/admin-system/ui";
import { VenueDialog, isTimeZone, timeZones } from "@/components/admin-system/venue-dialog";
import { useCan } from "@/components/staff-guard";
import { patch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage, keys } from "@/lib/queries";

/** Flags that expose the club beyond the local network or allow remote state changes. */
const DANGEROUS: readonly FeatureFlag[] = ["telegramStaffCommands", "remoteAccess"];
const CURRENCIES = ["EUR", "USD", "GBP", "RUB", "UAH", "KZT", "BYN", "GEL", "AMD", "TRY", "PLN", "CZK", "CHF", "SEK", "NOK", "DKK", "AED", "CAD", "AUD"];

/** Organization settings, feature flags, notification types and venues. */
export default function SettingsPage() {
  const t = useT();
  const can = useCan();
  const org = useOrganization();
  const editable = can("settings.manage");

  return (
    <div className="grid gap-6">
      <PageHeader className="mb-0" title={t("Settings")} description={t("Club-wide settings of this edge server.")} />
      {!editable && <Alert variant="warning">{t("You can view these settings but not change them (requires the “settings.manage” permission).")}</Alert>}
      {org.isLoading ? (
        <RowsSkeleton rows={6} />
      ) : org.error ? (
        <ErrorState error={org.error} onRetry={() => void org.refetch()} />
      ) : org.data ? (
        <>
          <OrganizationCard key={`${org.data.updatedAt}:${org.data.settings.version}`} org={org.data} editable={editable} />
          <FeatureFlagsCard org={org.data} editable={editable} />
          <NotificationTypesCard org={org.data} editable={editable} />
        </>
      ) : null}
      <VenuesCard defaultTimezone={org.data?.settings.timezone ?? "Europe/Berlin"} />
    </div>
  );
}

function useOrgUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<OrganizationView>("/api/v1/organizations/current", body),
    onSuccess: (res) => {
      qc.setQueryData(sysKeys.organization, res);
      // feature flags are part of the session view used by every surface
      void qc.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function OrganizationCard({ org, editable }: { org: OrganizationView; editable: boolean }) {
  const t = useT();
  const can = useCan();
  const update = useOrgUpdate();
  const [name, setName] = useState(org.name);
  const [locale, setLocale] = useState(org.settings.locale);
  const [timezone, setTimezone] = useState(org.settings.timezone);
  const [currency, setCurrency] = useState(org.settings.currency);
  const canRename = editable && can("organization.manage");

  const errors = {
    timezone: timezone && !isTimeZone(timezone) ? t("Unknown time zone.") : null,
    currency: !/^[A-Z]{3}$/.test(currency) ? t("Three-letter ISO code, e.g. EUR.") : null,
  };
  const body: Record<string, unknown> = {};
  if (name.trim() !== org.name) body.name = name.trim();
  if (locale !== org.settings.locale) body.locale = locale;
  if (timezone !== org.settings.timezone) body.timezone = timezone;
  if (currency !== org.settings.currency) body.currency = currency;
  const dirty = Object.keys(body).length > 0;
  const valid = name.trim().length > 0 && !errors.timezone && !errors.currency;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4 text-primary" /> {t("Organization")}
        </CardTitle>
        <CardDescription>{t("Name, language and regional defaults of the club.")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="org-form"
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && valid) update.mutate(body, { onSuccess: () => toast.success(t("Settings saved")) });
          }}
        >
          <Field label={t("Club name")} hint={!canRename ? t("Only the owner can rename the club.") : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={!canRename} />
          </Field>
          <Field label={t("Short address (slug)")} hint={t("Used in player links; cannot be changed here.")}>
            <Input value={org.slug} readOnly disabled className="font-mono" />
          </Field>
          <Field label={t("Default language")} hint={t("For player notifications and Telegram messages.")}>
            <Select value={locale} onChange={(e) => setLocale(e.target.value)} disabled={!editable}>
              <option value="en">English</option>
              <option value="ru">Русский</option>
              {!["en", "ru"].includes(locale) && <option value={locale}>{locale}</option>}
            </Select>
          </Field>
          <Field label={t("Time zone")} error={errors.timezone}>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value.trim())} list="org-timezones" disabled={!editable} />
            <datalist id="org-timezones">
              {timeZones().map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <Field label={t("Currency")} error={errors.currency}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().trim())} list="org-currencies" maxLength={3} className="font-mono uppercase" disabled={!editable} />
            <datalist id="org-currencies">
              {CURRENCIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </form>
      </CardContent>
      {editable && (
        <CardFooter className="justify-end">
          <Button type="submit" form="org-form" disabled={!dirty || !valid} loading={update.isPending}>
            {t("Save")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function FeatureFlagsCard({ org, editable }: { org: OrganizationView; editable: boolean }) {
  const t = useT();
  const L = useSysLabels();
  const update = useOrgUpdate();
  const { confirm, dialog } = useConfirm();
  const flags = org.settings.featureFlags;
  const pending = update.isPending ? Object.keys((update.variables?.featureFlags as Record<string, boolean> | undefined) ?? {}) : [];

  const set = (flag: FeatureFlag, value: boolean) => {
    const apply = () =>
      new Promise<void>((resolve) =>
        update.mutate(
          { featureFlags: { [flag]: value } },
          {
            onSuccess: () => {
              toast.success(value ? t("“{name}” turned on", { name: L.featureFlag[flag].label }) : t("“{name}” turned off", { name: L.featureFlag[flag].label }));
              resolve();
            },
            // the mutation already reports the error
            onError: () => resolve(),
          },
        ),
      );
    if (value && DANGEROUS.includes(flag)) {
      confirm({
        title: t("Turn on “{name}”?", { name: L.featureFlag[flag].label }),
        description: L.featureFlag[flag].description,
        confirmLabel: t("Turn on"),
        action: apply,
      });
    } else void apply();
  };

  return (
    <Card id="feature-flags" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ToggleRight className="size-4 text-primary" /> {t("Feature flags")}
        </CardTitle>
        <CardDescription>{t("Turn club features on or off. Changes apply to all devices immediately.")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {DANGEROUS.some((f) => flags[f]) && (
          <Alert variant="warning" title={t("Security-sensitive features are on")}>
            {DANGEROUS.filter((f) => flags[f])
              .map((f) => L.featureFlag[f].label)
              .join(", ")}
          </Alert>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          {FEATURE_FLAGS.map((f) => {
            const dangerous = DANGEROUS.includes(f);
            const on = !!flags[f];
            return (
              <label
                key={f}
                className={cn(
                  "flex items-start justify-between gap-4 rounded-lg border p-3",
                  dangerous ? (on ? "border-warning/60 bg-warning/10" : "border-warning/30") : "border-border",
                  editable && "cursor-pointer",
                )}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {L.featureFlag[f].label}
                    {dangerous && (
                      <Badge variant="warning">
                        <AlertTriangle className="size-3" /> {t("Security-sensitive")}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{L.featureFlag[f].description}</span>
                </span>
                <Switch checked={on} disabled={!editable || pending.includes(f)} onCheckedChange={(v) => set(f, v)} aria-label={L.featureFlag[f].label} />
              </label>
            );
          })}
        </div>
      </CardContent>
      {dialog}
    </Card>
  );
}

function NotificationTypesCard({ org, editable }: { org: OrganizationView; editable: boolean }) {
  const t = useT();
  const L = useSysLabels();
  const update = useOrgUpdate();
  const types = org.settings.notificationTypes;
  const pending = update.isPending ? Object.keys((update.variables?.notificationTypes as Record<string, boolean> | undefined) ?? {}) : [];
  const set = (type: NotificationType, value: boolean) =>
    update.mutate({ notificationTypes: { [type]: value } }, { onSuccess: () => toast.success(value ? t("Notification enabled") : t("Notification disabled")) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4 text-primary" /> {t("Notification types")}
        </CardTitle>
        <CardDescription>{t("A disabled type is not sent on any channel (Telegram, email, in-app). Players can additionally mute types for themselves.")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {NOTIFICATION_TYPES.map((type) => (
            <label key={type} className={cn("flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/40", editable && "cursor-pointer")}>
              <span className="text-sm">{L.notificationType[type]}</span>
              <Switch checked={types[type] !== false} disabled={!editable || pending.includes(type)} onCheckedChange={(v) => set(type, v)} aria-label={L.notificationType[type]} />
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function VenuesCard({ defaultTimezone }: { defaultTimezone: string }) {
  const t = useT();
  const can = useCan();
  const manage = can("venue.manage");
  const venues = useVenues();
  const [editing, setEditing] = useState<VenueRow | "new" | null>(null);
  const rows = venues.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-4 text-primary" /> {t("Venues")}
          </CardTitle>
          <CardDescription>{t("The local hostname of a venue drives the QR codes on the Local network page and the display links.")}</CardDescription>
        </div>
        {manage && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> {t("Add venue")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {venues.isLoading ? (
          <RowsSkeleton rows={2} />
        ) : venues.error ? (
          <ErrorState error={venues.error} onRetry={() => void venues.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<MapPin />} title={t("No venues yet")} className="p-6" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("Name")}</Th>
                <Th>{t("Time zone")}</Th>
                <Th>{t("Local hostname")}</Th>
                <Th>{t("Local address (URL)")}</Th>
                <Th>{t("Public address (URL)")}</Th>
                <Th className="text-right">
                  <span className="sr-only">{t("Actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-muted-foreground">
                      <code className="font-mono">{v.slug}</code>
                      {v.address && ` · ${v.address}`}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{v.timezone}</Td>
                  <Td className="font-mono text-xs">{v.localHostname ?? <span className="text-warning">{t("Not set")}</span>}</Td>
                  <Td className="max-w-56 truncate font-mono text-xs">{v.localUrl ?? "—"}</Td>
                  <Td className="max-w-56 truncate font-mono text-xs">{v.publicUrl ?? "—"}</Td>
                  <Td className="text-right">
                    {manage && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(v)}>
                        <Pencil /> {t("Edit")}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      {editing && <VenueDialog venue={editing === "new" ? null : editing} defaultTimezone={defaultTimezone} onClose={() => setEditing(null)} />}
    </Card>
  );
}
