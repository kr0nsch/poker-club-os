"use client";

import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Select,
  cn,
} from "@pcos/ui";
import { DISPLAY_WIDGETS, type DisplayTokenKind, type DisplayWidget, type TournamentSummaryView } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, MonitorPlay, TabletSmartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useStaff } from "@/components/staff-guard";
import { post, put } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";
import { useSysLabels } from "./labels";
import { sysKeys } from "./queries";
import type { DisplayTemplateRow, DisplayTokenCreated, VenueRow } from "./types";
import { CopyButton, QrImage } from "./ui";

// --- create display / kiosk link ------------------------------------------------------------

export function CreateTokenDialog({
  kind: initialKind,
  venues,
  tournaments,
  templates,
  onClose,
}: {
  kind: DisplayTokenKind;
  venues: VenueRow[];
  tournaments: TournamentSummaryView[];
  templates: DisplayTemplateRow[];
  onClose(): void;
}) {
  const t = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [kind, setKind] = useState<DisplayTokenKind>(initialKind);
  const [name, setName] = useState("");
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [tournamentId, setTournamentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  // The plaintext secret lives only in this component's state and disappears with it.
  const [created, setCreated] = useState<{ url: string; name: string; kind: DisplayTokenKind } | null>(null);

  const venueTournaments = tournaments.filter((x) => x.venueId === venueId && x.status !== "CANCELLED");
  const valid = name.trim().length > 0 && name.trim().length <= 80 && !!venueId;

  const create = useMutation({
    mutationFn: () =>
      post<DisplayTokenCreated>("/api/v1/display-tokens", {
        name: name.trim(),
        kind,
        venueId,
        tournamentId: tournamentId || null,
        displayTemplateId: kind === "DISPLAY" && templateId ? templateId : null,
      }),
    onSuccess: (res) => {
      setCreated({ url: res.localUrl ?? `${window.location.origin}${res.path}`, name: name.trim(), kind });
      void qc.invalidateQueries({ queryKey: sysKeys.displayTokens });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        wide={!!created}
        onInteractOutside={(e) => {
          // Do not lose the one-time secret on a stray click.
          if (created) e.preventDefault();
        }}
      >
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.kind === "KIOSK" ? t("Kiosk link created") : t("Display link created")}</DialogTitle>
              <DialogDescription>{created.name}</DialogDescription>
            </DialogHeader>
            <Alert variant="warning" title={t("This link is shown only once")}>
              {t("Copy it or scan the QR code now. The secret cannot be displayed again: if it is lost, revoke this link and create a new one.")}
            </Alert>
            <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="flex justify-center">
                <QrImage value={created.url} size={184} alt={t("QR code of the new link")} />
              </div>
              <div className="grid min-w-0 gap-4">
                <Field label={t("Link")}>
                  <div className="flex gap-2">
                    <Input readOnly value={created.url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                    <CopyButton value={created.url} className="h-10" />
                  </div>
                </Field>
                <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-muted-foreground">
                  <li>{created.kind === "KIOSK" ? t("Open the link in the kiosk tablet's browser and pin it full screen.") : t("Open the link in the TV's browser and switch it to full screen.")}</li>
                  <li>{t("On a tablet, scan the QR code with the camera instead of typing the address.")}</li>
                  <li>{t("The device needs no sign-in. Keep it on the staff Wi-Fi.")}</li>
                </ol>
              </div>
            </div>
            <DialogFooter>
              <Button asChild variant="outline">
                <a href={created.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> {t("Open on this device")}
                </a>
              </Button>
              <Button onClick={onClose}>{t("Done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("New display or kiosk link")}</DialogTitle>
              <DialogDescription>{t("Creates a secret link for a TV display or a self check-in kiosk. The device opens it without signing in.")}</DialogDescription>
            </DialogHeader>
            {venues.length === 0 ? (
              <Alert variant="warning">{t("Create a venue first (Settings → Venues).")}</Alert>
            ) : (
              <form
                id="create-display-token"
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid) create.mutate();
                }}
              >
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Type")}>
                  {(["DISPLAY", "KIOSK"] as const).map((k) => {
                    const Icon = k === "DISPLAY" ? MonitorPlay : TabletSmartphone;
                    return (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        onClick={() => setKind(k)}
                        className={cn(
                          "flex items-start gap-2.5 rounded-lg border p-3 text-left text-sm transition-colors",
                          kind === k ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                        )}
                      >
                        <Icon className={cn("mt-0.5 size-4 shrink-0", kind === k ? "text-primary" : "text-muted-foreground")} />
                        <span>
                          <span className="block font-medium">{k === "DISPLAY" ? t("TV display") : t("Kiosk")}</span>
                          <span className="block text-xs text-muted-foreground">{k === "DISPLAY" ? t("Clock, blinds and announcements") : t("Player self check-in")}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Field label={t("Name")} hint={t("Where the device is, e.g. “TV by the bar” or “Entrance kiosk”.")}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
                </Field>
                <Field label={t("Venue")}>
                  <Select
                    value={venueId}
                    onChange={(e) => {
                      setVenueId(e.target.value);
                      setTournamentId("");
                    }}
                  >
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("Tournament")} hint={t("Automatic: always shows the venue's current tournament (the live one, otherwise the next one).")}>
                  <Select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
                    <option value="">{t("Automatic: the venue's current tournament")}</option>
                    {venueTournaments.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} · {fmt.dateTime(x.startAt)} · {t(x.status)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {kind === "DISPLAY" && (
                  <Field label={t("Display template")}>
                    <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                      <option value="">{t("Organization default")}</option>
                      {templates.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </form>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {t("Cancel")}
              </Button>
              <Button type="submit" form="create-display-token" disabled={!valid || venues.length === 0} loading={create.isPending}>
                <KeyRound /> {t("Create link")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- display template ---------------------------------------------------------------------------

const DEFAULT_WIDGETS: DisplayWidget[] = ["CLOCK", "BLINDS", "NEXT_LEVEL", "NEXT_BREAK", "ENTRIES", "REMAINING", "AVERAGE_STACK", "ANNOUNCEMENTS"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const id = `color-${label.replace(/\W+/g, "-")}`;
  return (
    <Field label={label} htmlFor={id} error={HEX.test(value) ? null : "#RRGGBB"}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={HEX.test(value) && value.length === 7 ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value.trim())} maxLength={16} className="font-mono" aria-invalid={!HEX.test(value)} />
      </div>
    </Field>
  );
}

export function TemplateDialog({ template, onClose }: { template: DisplayTemplateRow | null; onClose(): void }) {
  const t = useT();
  const L = useSysLabels();
  const qc = useQueryClient();
  const theme = template?.theme ?? {};
  const [name, setName] = useState(template?.name ?? "");
  const [widgets, setWidgets] = useState<DisplayWidget[]>(template?.widgets ?? DEFAULT_WIDGETS);
  const [accent, setAccent] = useState(theme.accent ?? "#22c55e");
  const [background, setBackground] = useState(theme.background ?? "#050b09");
  const [sponsorText, setSponsorText] = useState(theme.sponsorText ?? "");
  const valid = name.trim().length > 0 && widgets.length > 0 && HEX.test(accent) && HEX.test(background) && sponsorText.length <= 120;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        widgets: DISPLAY_WIDGETS.filter((w) => widgets.includes(w)),
        // keep fields this form does not edit (e.g. logoFileId)
        theme: { ...theme, accent, background, sponsorText: sponsorText.trim() || null },
      };
      return template ? put<DisplayTemplateRow>(`/api/v1/display-templates/${template.id}`, body) : post<DisplayTemplateRow>("/api/v1/display-templates", body);
    },
    onSuccess: () => {
      toast.success(template ? t("Template saved") : t("Template created"));
      void qc.invalidateQueries({ queryKey: sysKeys.displayTemplates });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (w: DisplayWidget, on: boolean) => setWidgets((prev) => (on ? [...prev.filter((x) => x !== w), w] : prev.filter((x) => x !== w)));
  const has = (w: DisplayWidget) => widgets.includes(w);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{template ? t("Edit display template") : t("New display template")}</DialogTitle>
          <DialogDescription>{t("Choose what TV displays show and how they look. Displays pick up changes automatically.")}</DialogDescription>
        </DialogHeader>
        <form
          id="display-template-form"
          className="grid gap-5 md:grid-cols-[1fr_17rem]"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <div className="grid content-start gap-4">
            <Field label={t("Name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
            </Field>
            <div className="grid gap-2">
              <Label>{t("Widgets")}</Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {DISPLAY_WIDGETS.map((w) => (
                  <Checkbox
                    key={w}
                    checked={has(w)}
                    onChange={(e) => toggle(w, e.target.checked)}
                    label={L.widget[w]}
                    className={cn("rounded-md border px-2.5 py-2", has(w) ? "border-primary/50 bg-primary/10" : "border-border")}
                  />
                ))}
              </div>
              {widgets.length === 0 && <p className="text-xs text-destructive">{t("Select at least one widget.")}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label={t("Accent color")} value={accent} onChange={setAccent} />
              <ColorField label={t("Background color")} value={background} onChange={setBackground} />
            </div>
            <Field label={t("Sponsor text")} hint={t("Shown by the Sponsor widget. Up to 120 characters.")}>
              <Input value={sponsorText} onChange={(e) => setSponsorText(e.target.value)} maxLength={120} />
            </Field>
          </div>
          <div className="grid content-start gap-2">
            <Label>{t("Preview")}</Label>
            <TemplatePreview widgets={widgets} accent={HEX.test(accent) ? accent : "#22c55e"} background={HEX.test(background) ? background : "#050b09"} sponsorText={sponsorText} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" form="display-template-form" disabled={!valid} loading={save.isPending}>
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "#abc" → "#aabbcc" so an alpha suffix can be appended. */
function expandHex(hex: string) {
  return /^#[0-9a-f]{3}$/i.test(hex) ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

/** Schematic TV preview (not the real display renderer). */
export function TemplatePreview({ widgets, accent: rawAccent, background, sponsorText, compact = false }: { widgets: DisplayWidget[]; accent: string; background: string; sponsorText?: string | null; compact?: boolean }) {
  const t = useT();
  const L = useSysLabels();
  const me = useStaff();
  const accent = expandHex(rawAccent);
  const has = (w: DisplayWidget) => widgets.includes(w);
  const tile = (w: DisplayWidget, value: string) =>
    has(w) && (
      <div key={w} className="rounded-md bg-white/5 px-2 py-1.5">
        <div className="truncate text-[10px] uppercase tracking-wide text-white/50">{L.widget[w]}</div>
        <div className="truncate text-sm font-semibold text-white/90 tabular-nums">{value}</div>
      </div>
    );
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border shadow-inner", compact ? "aspect-video p-2.5" : "aspect-[4/3] p-3.5")} style={{ background }}>
      <div className="flex h-full flex-col gap-2 text-white">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/50">
          <span className="truncate">{has("LOGO") ? `♠ ${me.organization?.name ?? ""}` : ""}</span>
          <span>
            {t("Level")} 7
          </span>
        </div>
        {has("CLOCK") && (
          <div className={cn("clock-digits text-center font-bold leading-none", compact ? "text-3xl" : "text-5xl")} style={{ color: accent }}>
            18:42
          </div>
        )}
        {has("BLINDS") && <div className="text-center text-sm font-medium text-white/85 tabular-nums">1 000 / 2 000 · {t("Ante")} 2 000</div>}
        {!compact && (
          <div className="grid grid-cols-3 gap-1.5">
            {tile("NEXT_LEVEL", "1 500 / 3 000")}
            {tile("NEXT_BREAK", "0:42")}
            {tile("ENTRIES", "86")}
            {tile("REMAINING", "41")}
            {tile("AVERAGE_STACK", "62 900")}
            {tile("PRIZE_POOL", "€ 8 600")}
          </div>
        )}
        <div className="mt-auto grid gap-1">
          {has("ANNOUNCEMENTS") && (
            <div className="truncate rounded px-2 py-1 text-[11px] font-medium" style={{ background: `${accent}33`, color: accent }}>
              {t("Announcements")}
            </div>
          )}
          {has("SPONSOR") && sponsorText && <div className="truncate text-center text-[11px] text-white/60">{sponsorText}</div>}
        </div>
      </div>
    </div>
  );
}
