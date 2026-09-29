"use client";

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from "@pcos/ui";
import { CONSENT_TYPES, PLAYER_STATUSES, type ConsentType, type PlayerStatus } from "@pcos/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Send, ShieldAlert, Tag, Trash2, UserCheck, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CONSENT_LABEL, PLAYER_STATUS_LABEL, PLAYER_STATUS_TONE } from "@/components/admin-config/labels";
import { PLAYER_FIELDS, PlayerFields, playerFormFrom, playerValues, type PlayerField, type PlayerForm } from "@/components/admin-config/player-form";
import { cfgKeys, usePlayerTags } from "@/components/admin-config/queries";
import type { PlayerDetail, PlayerSummary } from "@/components/admin-config/types";
import { BackLink, ConfirmDialog, QueryError, Section, SaveBar, useUnsavedChangesWarning } from "@/components/admin-config/ui";
import { pick, stableStringify, threeWay } from "@/components/admin-config/utils";
import { useCan } from "@/components/staff-guard";
import { StatusBadge } from "@/components/status";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const q = useQuery({ queryKey: cfgKeys.player(id), queryFn: () => get<PlayerDetail>(`/api/v1/players/${id}`) });
  if (q.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div>
        <BackLink href="/admin/players" label={t("Players")} />
        {notFound ? <EmptyState icon={<UserRound />} title={t("Player not found")} /> : <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      </div>
    );
  }
  return <Profile key={q.data.id} player={q.data} />;
}

function Profile({ player }: { player: PlayerDetail }) {
  const t = useT();
  const fmt = useFormat();
  const p = player;
  return (
    <div>
      <BackLink href="/admin/players" label={t("Players")} />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.displayName}
            <Badge variant={PLAYER_STATUS_TONE[p.status]}>{t(PLAYER_STATUS_LABEL[p.status])}</Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {p.firstName} {p.lastName}
              {p.nickname ? ` · “${p.nickname}”` : ""}
            </span>
            <span className="font-mono">{p.externalPublicId}</span>
            {p.memberNumber && (
              <span>
                {t("Member no.")} <span className="font-mono">{p.memberNumber}</span>
              </span>
            )}
            {p.hasAccount && (
              <span className="inline-flex items-center gap-1">
                <UserCheck className="size-3.5" /> {t("Player account")}
              </span>
            )}
            {p.telegram && (
              <span className="inline-flex items-center gap-1">
                <Send className="size-3.5" /> Telegram
              </span>
            )}
          </span>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Tournaments")} value={fmt.number(p.stats.tournaments)} />
        <Stat label={t("Wins")} value={fmt.number(p.stats.wins)} />
        <Stat label={t("Best finish")} value={p.stats.bestFinish != null ? `#${p.stats.bestFinish}` : "—"} />
        <Stat label={t("Last visit")} value={<span className="text-lg">{p.stats.lastVisit ? fmt.date(p.stats.lastVisit) : "—"}</span>} />
        <Stat label={t("No-shows")} value={fmt.number(p.stats.noShows)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <EditCard player={p} />
          <HistoryCard player={p} />
        </div>
        <div className="grid content-start gap-4">
          <TagsCard player={p} />
          <NotesCard player={p} />
          <KioskCard player={p} />
          <TelegramCard player={p} />
          <ConsentsCard player={p} />
          <DangerCard player={p} />
        </div>
      </div>
    </div>
  );
}

// --- edit -------------------------------------------------------------------------------------------------

function EditCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const canEdit = can("player.edit");
  const [base, setBase] = useState<PlayerDetail>(player);
  const baseForm = useMemo(() => playerFormFrom(base), [base]);
  const [form, setForm] = useState<PlayerForm>(baseForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = stableStringify(form) !== stableStringify(baseForm);
  useUnsavedChangesWarning(dirty);

  // Follow changes from elsewhere (consents, other devices) while not editing.
  const serverSig = stableStringify(playerFormFrom(player));
  const [seenSig, setSeenSig] = useState(serverSig);
  if (serverSig !== seenSig) {
    setSeenSig(serverSig);
    if (!dirty) {
      setBase(player);
      setForm(playerFormFrom(player));
    }
  }
  const set = <K extends keyof PlayerForm>(k: K, v: PlayerForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const label: Record<PlayerField, string> = {
    firstName: t("First name"),
    lastName: t("Last name"),
    displayName: t("Display name"),
    nickname: t("Nickname"),
    email: t("Email"),
    phone: t("Phone"),
    memberNumber: t("Member number"),
    language: t("Language"),
    country: t("Country"),
    dateOfBirth: t("Date of birth"),
    status: t("Status"),
    marketingConsent: t("Marketing consent"),
    publicProfileEnabled: t("Public profile"),
  };

  /** Sends only changed fields; merges edits made elsewhere, stops on a real conflict. */
  async function save() {
    setMessage(null);
    const mine = playerValues(form, t, { requireDisplayName: true });
    setErrors(mine.errors);
    if (Object.keys(mine.errors).length > 0) return;
    setSaving(true);
    try {
      const baseValues = playerValues(baseForm, t).values;
      let latest = base;
      for (let attempt = 0; ; attempt++) {
        const theirsForm = playerFormFrom(latest);
        const theirsValues = playerValues(theirsForm, t).values;
        const { changedByMe, conflicts } = threeWay(baseValues, mine.values, theirsValues, PLAYER_FIELDS);
        if (changedByMe.length === 0) return;
        if (conflicts.length > 0) {
          const merged = { ...theirsForm };
          for (const k of changedByMe) (merged as unknown as Record<string, unknown>)[k] = form[k];
          setBase(latest);
          setForm(merged);
          setMessage({ tone: "warning", text: t("Also changed on another device: {fields}. Your values are kept — review and save again.", { fields: conflicts.map((k) => label[k]).join(", ") }) });
          return;
        }
        // Workaround: the API applies schema defaults (false) to omitted consent flags of a
        // partial update, which would silently withdraw marketing consent. Always send them.
        const body = { expectedVersion: latest.version, marketingConsent: theirsValues.marketingConsent, publicProfileEnabled: theirsValues.publicProfileEnabled, ...pick(mine.values, changedByMe) };
        try {
          const updated = await patch<PlayerSummary>(`/api/v1/players/${player.id}`, body);
          const fresh = await qc.fetchQuery({ queryKey: cfgKeys.player(player.id), queryFn: () => get<PlayerDetail>(`/api/v1/players/${player.id}`), staleTime: 0 });
          setBase(fresh);
          setForm(playerFormFrom(fresh));
          setSeenSig(stableStringify(playerFormFrom(fresh)));
          void qc.invalidateQueries({ queryKey: cfgKeys.players });
          toast.success(t("Saved: {name}", { name: updated.displayName }));
          return;
        } catch (e) {
          if (e instanceof ApiError && e.isConflict && attempt < 2) {
            latest = await get<PlayerDetail>(`/api/v1/players/${player.id}`);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title={t("Personal data")} description={canEdit ? undefined : t("You can view but not edit players.")}>
      <PlayerFields
        form={form}
        set={set}
        errors={errors}
        disabled={!canEdit}
        extra={
          <Field label={t("Status")} className="sm:col-span-2">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as PlayerStatus)} disabled={!canEdit}>
              {PLAYER_STATUSES.filter((s) => s !== "MERGED" || form.status === "MERGED").map((s) => (
                <option key={s} value={s}>
                  {t(PLAYER_STATUS_LABEL[s])}
                </option>
              ))}
            </Select>
          </Field>
        }
      />
      {canEdit && (
        <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setForm(baseForm)} disabled={!dirty} className="mx-0 mt-0 bg-card/95 px-0 md:mx-0 md:px-0">
          {message ? <span className={message.tone === "error" ? "text-destructive" : "text-warning"}>{message.text}</span> : undefined}
        </SaveBar>
      )}
    </Section>
  );
}

// --- history ----------------------------------------------------------------------------------------------

function HistoryCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <Section title={t("Tournament history")} contentClassName="p-0 sm:p-5 sm:pt-0">
      {player.history.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground sm:p-0">{t("No tournaments yet.")}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("Date")}</Th>
              <Th>{t("Tournament")}</Th>
              <Th className="hidden sm:table-cell">{t("Registration")}</Th>
              <Th className="text-right">{t("Place")}</Th>
              <Th className="hidden text-right md:table-cell">{t("Entries")}</Th>
              <Th className="text-right">{t("Points")}</Th>
            </Tr>
          </THead>
          <TBody>
            {player.history.map((h) => (
              <Tr key={`${h.tournamentId}-${h.registrationStatus}`}>
                <Td className="whitespace-nowrap tabular-nums">{fmt.date(h.startAt)}</Td>
                <Td>
                  <Link href={`/admin/tournaments/${h.tournamentId}`} className="hover:underline">
                    {h.name}
                  </Link>
                </Td>
                <Td className="hidden sm:table-cell">
                  <StatusBadge status={h.registrationStatus} />
                </Td>
                <Td className="text-right font-medium tabular-nums">{h.position ?? "—"}</Td>
                <Td className="hidden text-right tabular-nums md:table-cell">{h.entries ?? "—"}</Td>
                <Td className="text-right tabular-nums">{h.points != null ? fmt.number(h.points) : "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

// --- tags ---------------------------------------------------------------------------------------------------

function TagsCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const tags = usePlayerTags();
  const [name, setName] = useState("");
  const canEdit = can("player.edit");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: cfgKeys.player(player.id) });
    void qc.invalidateQueries({ queryKey: cfgKeys.players });
    void qc.invalidateQueries({ queryKey: cfgKeys.playerTags });
  };
  const add = useMutation({
    mutationFn: (tag: string) => post(`/api/v1/players/${player.id}/tags`, { name: tag }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (tagId: string) => del(`/api/v1/players/${player.id}/tags/${tagId}`),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const suggestions = tags.data?.filter((x) => !player.tags.some((p) => p.id === x.id)) ?? [];
  return (
    <Section title={t("Tags")}>
      <div className="flex flex-wrap gap-1.5">
        {player.tags.length === 0 && <span className="text-sm text-muted-foreground">{t("No tags")}</span>}
        {player.tags.map((x) => (
          <Badge key={x.id} variant="secondary" className="gap-1 pr-1">
            <Tag className="size-3" /> {x.name}
            {canEdit && (
              <button type="button" className="rounded-full p-0.5 hover:bg-background/60" onClick={() => remove.mutate(x.id)} aria-label={t("Remove tag {name}", { name: x.name })} disabled={remove.isPending}>
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate(name.trim());
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Add a tag")} maxLength={40} list={`tags-${player.id}`} className="h-9" />
          <datalist id={`tags-${player.id}`}>
            {suggestions.map((x) => (
              <option key={x.id} value={x.name} />
            ))}
          </datalist>
          <Button type="submit" size="sm" className="h-9" disabled={!name.trim()} loading={add.isPending}>
            {t("Add")}
          </Button>
        </form>
      )}
    </Section>
  );
}

// --- notes --------------------------------------------------------------------------------------------------

function NotesCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"STAFF" | "MANAGEMENT">("STAFF");
  const add = useMutation({
    mutationFn: () => post(`/api/v1/players/${player.id}/notes`, { body: body.trim(), visibility }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: cfgKeys.player(player.id) });
      toast.success(t("Note added"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can("player.notes.read")) return null;
  return (
    <Section title={t("Staff notes")} description={t("Never shown to the player.")}>
      {can("player.notes.write") && (
        <div className="grid gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} placeholder={t("e.g. prefers seat 1, needs a table near the exit")} />
          <div className="flex items-center justify-between gap-2">
            {can("staff.manage") ? (
              <Select className="h-9 w-auto py-1" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} aria-label={t("Visibility")}>
                <option value="STAFF">{t("All staff")}</option>
                <option value="MANAGEMENT">{t("Management only")}</option>
              </Select>
            ) : (
              <span />
            )}
            <Button size="sm" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>
              {t("Add note")}
            </Button>
          </div>
        </div>
      )}
      {player.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No notes yet.")}</p>
      ) : (
        <ul className="grid gap-3">
          {player.notes.map((n) => (
            <li key={n.id} className="rounded-md border border-border p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{n.author ?? t("Unknown")}</span>
                <span>·</span>
                <span>{fmt.dateTime(n.createdAt)}</span>
                {n.visibility === "MANAGEMENT" && <Badge variant="warning">{t("Management only")}</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// --- kiosk ---------------------------------------------------------------------------------------------------

function KioskCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const setPinM = useMutation({
    mutationFn: () => post(`/api/v1/players/${player.id}/kiosk-pin`, { pin }),
    onSuccess: () => {
      setPin("");
      void qc.invalidateQueries({ queryKey: cfgKeys.player(player.id) });
      toast.success(t("Kiosk PIN set"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const codeM = useMutation({
    mutationFn: () => post<{ code: string; expiresAt: string }>(`/api/v1/players/${player.id}/one-time-code`),
    onSuccess: setCode,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pinValid = /^\d{4,8}$/.test(pin);
  return (
    <Section title={t("Kiosk check-in")}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" /> {t("PIN")}
        </span>
        {player.hasKioskPin ? <Badge variant="success">{t("Set")}</Badge> : <Badge variant="muted">{t("Not set")}</Badge>}
      </div>
      {can("player.edit") &&
        (player.memberNumber ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pinValid) setPinM.mutate();
            }}
          >
            <Input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder={t("4–8 digits")} className="h-9 font-mono" aria-label={t("New kiosk PIN")} />
            <Button type="submit" size="sm" className="h-9" disabled={!pinValid} loading={setPinM.isPending}>
              {player.hasKioskPin ? t("Change PIN") : t("Set PIN")}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">{t("Assign a member number first: players sign in at the kiosk with member number + PIN.")}</p>
        ))}
      {can("registration.checkin") && (
        <div className="grid gap-2 border-t border-border pt-3">
          <div className="text-sm">{t("One-time code")}</div>
          {code ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-center">
              <div className="font-mono text-3xl font-semibold tracking-[0.3em]">{code.code}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("Valid until {time} ({relative}), single use", { time: fmt.time(code.expiresAt), relative: fmt.relative(code.expiresAt) })}</div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("A 6-digit code for one kiosk check-in, valid 15 minutes.")}</p>
          )}
          <Button size="sm" variant="outline" loading={codeM.isPending} onClick={() => codeM.mutate()}>
            {code ? t("Issue a new code") : t("Issue code")}
          </Button>
        </div>
      )}
    </Section>
  );
}

// --- telegram --------------------------------------------------------------------------------------------------

function TelegramCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <Section title="Telegram">
      {player.telegram ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-2">
            <Send className="size-4 text-primary" />
            {player.telegram.username ? `@${player.telegram.username}` : t("Linked")}
          </span>
          <span className="text-xs text-muted-foreground">{t("since {date}", { date: fmt.date(player.telegram.linkedAt) })}</span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("Not linked. Players connect Telegram from their profile or via the club bot.")}</p>
      )}
    </Section>
  );
}

// --- consents ---------------------------------------------------------------------------------------------------

function ConsentsCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [type, setType] = useState<ConsentType>("MARKETING");
  const [granted, setGranted] = useState("true");
  const record = useMutation({
    mutationFn: () => post(`/api/v1/players/${player.id}/consents`, { type, granted: granted === "true", source: "STAFF" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cfgKeys.player(player.id) });
      toast.success(t("Consent recorded"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title={t("Consents")} description={t("Full history; the latest entry of each type applies.")}>
      {can("player.edit") && (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Select className="h-9 py-1" value={type} onChange={(e) => setType(e.target.value as ConsentType)} aria-label={t("Consent")}>
              {CONSENT_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(CONSENT_LABEL[c])}
                </option>
              ))}
            </Select>
            <Select className="h-9 py-1" value={granted} onChange={(e) => setGranted(e.target.value)} aria-label={t("Decision")}>
              <option value="true">{t("Granted")}</option>
              <option value="false">{t("Withdrawn")}</option>
            </Select>
          </div>
          <Button size="sm" variant="outline" loading={record.isPending} onClick={() => record.mutate()}>
            {t("Record consent")}
          </Button>
        </div>
      )}
      {player.consents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No consents recorded.")}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {player.consents.map((c, i) => (
            <li key={`${c.type}-${c.createdAt}-${i}`} className="flex items-start justify-between gap-2">
              <div>
                <div>{t(CONSENT_LABEL[c.type])}</div>
                <div className="text-xs text-muted-foreground">
                  {fmt.dateTime(c.createdAt)} · {t(c.source)}
                </div>
              </div>
              <Badge variant={c.granted ? "success" : "muted"}>{c.granted ? t("Granted") : t("Withdrawn")}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// --- anonymize ----------------------------------------------------------------------------------------------------

function DangerCard({ player }: { player: PlayerDetail }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const anonymize = useMutation({
    mutationFn: () => post(`/api/v1/players/${player.id}/anonymize`),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: cfgKeys.player(player.id) });
      void qc.invalidateQueries({ queryKey: cfgKeys.players });
      toast.success(t("Personal data removed"));
    },
  });
  if (!can("settings.manage") || !can("player.edit")) return null;
  const done = player.firstName === "Anonymized" && !player.email && !player.phone;
  return (
    <Section title={t("Data protection")}>
      <p className="text-sm text-muted-foreground">{t("Erase personal data on request. Results stay in tournament history under an anonymous name.")}</p>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)} disabled={done}>
        <ShieldAlert /> {done ? t("Already anonymized") : t("Anonymize player…")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setUnderstood(false);
            anonymize.reset();
          }
        }}
        title={t("Anonymize {name}?", { name: player.displayName })}
        description={t("Name, contacts, member number, kiosk PIN and staff notes are deleted and Telegram is unlinked. This cannot be undone.")}
        confirmLabel={
          <>
            <Trash2 /> {t("Anonymize")}
          </>
        }
        loading={anonymize.isPending}
        confirmDisabled={!understood}
        onConfirm={() => anonymize.mutate()}
      >
        {anonymize.isError && <Alert variant="destructive">{errorMessage(anonymize.error)}</Alert>}
        <Checkbox label={t("I understand that this is permanent")} checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
      </ConfirmDialog>
    </Section>
  );
}
