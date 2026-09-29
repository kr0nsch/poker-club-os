"use client";

import { Badge, Button, Card, Chip, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, Field, Input, Spinner } from "@pcos/ui";
import type { RegistrationView } from "@pcos/types";
import { useQuery } from "@tanstack/react-query";
import { Ban, Check, ListPlus, MoreVertical, Repeat, Search, Undo2, UserPlus, UserRoundX } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, get, post } from "@/lib/api";
import { lateRegistrationOpen, useDerivedClock } from "@/lib/clock";
import { useFormat, useT } from "@/lib/i18n";
import { StatusBadge } from "@/components/status";
import { useFloor } from "./floor-context";

interface PlayerHit {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  memberNumber: string | null;
  phone: string | null;
  status: string;
}

const ACTIVE = new Set(["RESERVED", "REGISTERED", "CHECKED_IN", "PLAYING", "ELIMINATED", "WAITLISTED"]);

export function RegistrationDesk() {
  const t = useT();
  const fmt = useFormat();
  const { snapshot, run, pending } = useFloor();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const [filter, setFilter] = useState<string>("ALL");
  const [quickAdd, setQuickAdd] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", nickname: "", phone: "", email: "" });
  const [adding, setAdding] = useState(false);
  const status = snapshot.tournament.status;
  const canCheckIn = ["REGISTRATION_OPEN", "SEATING", "RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"].includes(status);
  const clock = useDerivedClock(snapshot.clock, snapshot.levels, 5_000);
  const closedForNew = ["RUNNING", "BREAK", "PAUSED", "HAND_FOR_HAND"].includes(status) && !lateRegistrationOpen(snapshot.tournament, clock);

  const hits = useQuery({
    queryKey: ["players", "search", dq],
    queryFn: () => get<{ total: number; items: PlayerHit[] }>(`/api/v1/players?q=${encodeURIComponent(dq)}&limit=12`),
    enabled: dq.length >= 2,
    staleTime: 10_000,
  });

  const byPlayer = useMemo(() => {
    const m = new Map<string, RegistrationView>();
    for (const r of snapshot.registrations) if (ACTIVE.has(r.status)) m.set(r.playerId, r);
    return m;
  }, [snapshot.registrations]);
  const entryOfPlayer = (playerId: string) => snapshot.entries.find((e) => e.playerId === playerId && e.status === "ACTIVE");

  function seatToast(res: { result: { seat?: { tableNumber: number; seatNumber: number } | null } } | null, name: string) {
    const seat = res?.result.seat;
    if (seat) toast.success(`${name}: ${t("Table {table}, seat {seat}", { table: seat.tableNumber, seat: seat.seatNumber })}`, { duration: 8000 });
    else if (res) toast.success(t("{name} checked in", { name }));
  }

  async function registerAndCheckIn(playerId: string, name: string, checkIn: boolean) {
    const reg = await run<{ registrationId: string; status: string }>("REGISTER_PLAYER", { playerId, source: "STAFF" });
    if (!reg) return;
    if (reg.result.status === "WAITLISTED") return void toast.warning(t("{name} added to the waitlist", { name }));
    if (!checkIn) return void toast.success(t("{name} registered", { name }));
    const ci = await run<{ seat: { tableNumber: number; seatNumber: number } | null }>("CHECK_IN", { registrationId: reg.result.registrationId, createEntry: true, seat: "AUTO" });
    seatToast(ci, name);
  }

  function primaryAction(playerId: string, name: string) {
    const reg = byPlayer.get(playerId);
    if (!reg) {
      return (
        <div className="flex gap-2">
          <Button size="lg" disabled={pending || closedForNew} onClick={() => registerAndCheckIn(playerId, name, canCheckIn)}>
            {canCheckIn ? <Check /> : <UserPlus />} {canCheckIn ? t("Check in and seat") : t("Register")}
          </Button>
          {canCheckIn && (
            <Button size="lg" variant="outline" disabled={pending || closedForNew} onClick={() => registerAndCheckIn(playerId, name, false)} title={t("Register without check-in")}>
              <ListPlus />
            </Button>
          )}
        </div>
      );
    }
    switch (reg.status) {
      case "REGISTERED":
      case "RESERVED":
        return (
          <Button size="lg" disabled={pending || !canCheckIn} onClick={async () => seatToast(await run("CHECK_IN", { registrationId: reg.id, createEntry: true, seat: "AUTO" }), name)}>
            <Check /> {t("Check in and seat")}
          </Button>
        );
      case "CHECKED_IN":
        return (
          <Button size="lg" disabled={pending} onClick={async () => seatToast(await run("CREATE_ENTRY", { registrationId: reg.id, seat: "AUTO" }), name)}>
            <Check /> {t("Buy-in")}
          </Button>
        );
      case "ELIMINATED":
        return (
          <Button size="lg" variant="secondary" disabled={pending || closedForNew} onClick={async () => seatToast(await run("CREATE_ENTRY", { registrationId: reg.id, seat: "AUTO" }), name)}>
            <Repeat /> {t("Re-entry")}
          </Button>
        );
      case "WAITLISTED":
        return (
          <Button size="lg" variant="warning" disabled={pending} onClick={() => run("PROMOTE_WAITLIST", { registrationId: reg.id }, { success: t("Promoted from the waitlist") })}>
            {t("Promote")}
          </Button>
        );
      case "PLAYING": {
        const e = entryOfPlayer(playerId);
        return <Badge variant="success">{e?.tableNumber ? `${t("Table")} ${e.tableNumber} · ${t("Seat")} ${e.seatNumber}` : t("PLAYING")}</Badge>;
      }
      default:
        return <StatusBadge status={reg.status} />;
    }
  }

  async function quickCreate(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const p = await post<PlayerHit>("/api/v1/players", {
        firstName: form.firstName,
        lastName: form.lastName,
        nickname: form.nickname || null,
        phone: form.phone || null,
        email: form.email || null,
        source: "WALK_IN",
      });
      setQuickAdd(false);
      setForm({ firstName: "", lastName: "", nickname: "", phone: "", email: "" });
      await registerAndCheckIn(p.id, p.displayName, canCheckIn);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("Something went wrong"));
    } finally {
      setAdding(false);
    }
  }

  const list = snapshot.registrations.filter((r) => filter === "ALL" || r.status === filter).slice().reverse();
  const counts = snapshot.registrations.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Name, nickname, phone, e-mail or member number")} className="h-14 pl-11 text-lg" />
          </div>
          <Button size="xl" variant="secondary" onClick={() => setQuickAdd(true)} title={t("Quick add player")}>
            <UserPlus />
          </Button>
        </div>
        {closedForNew && <p className="mb-2 text-sm text-warning">{t("Late registration is closed: new players and re-entries are not accepted.")}</p>}
        {dq.length < 2 && <p className="text-sm text-muted-foreground">{t("Type at least two characters to search the player database.")}</p>}
        {hits.isFetching && <Spinner />}
        {hits.data && hits.data.items.length === 0 && (
          <EmptyState
            title={t("No players found")}
            action={
              <Button onClick={() => setQuickAdd(true)}>
                <UserPlus /> {t("Quick add player")}
              </Button>
            }
          />
        )}
        <div className="grid gap-2">
          {hits.data?.items.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">
                  {p.firstName} {p.lastName}
                  {p.nickname && <span className="ml-1 font-normal text-muted-foreground">«{p.nickname}»</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[p.memberNumber && `#${p.memberNumber}`, p.phone].filter(Boolean).join(" · ")}
                  {p.status !== "ACTIVE" && <Badge variant="destructive" className="ml-2">{p.status}</Badge>}
                </div>
              </div>
              {p.status === "BANNED" ? <Badge variant="destructive">{t("Banned")}</Badge> : primaryAction(p.id, p.displayName)}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["ALL", "REGISTERED", "CHECKED_IN", "PLAYING", "WAITLISTED", "ELIMINATED", "CANCELLED", "NO_SHOW"].map((s) => (
            <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
              {s === "ALL" ? t("All") : t(s)}
              <span className="tabular-nums opacity-60">{s === "ALL" ? snapshot.registrations.length : (counts[s] ?? 0)}</span>
            </Chip>
          ))}
        </div>
        <div className="grid max-h-[60dvh] gap-1.5 overflow-y-auto pr-1">
          {list.length === 0 && <p className="text-sm text-muted-foreground">{t("No registrations yet.")}</p>}
          {list.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.playerName}</div>
                <div className="text-xs text-muted-foreground">
                  {t(r.source)} · {fmt.time(r.registeredAt)}
                  {r.checkedInAt && ` · ✓ ${fmt.time(r.checkedInAt)}`}
                  {r.waitlistPosition && ` · #${r.waitlistPosition}`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <StatusBadge status={r.status} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("Actions")}>
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(r.status === "REGISTERED" || r.status === "RESERVED") && (
                      <DropdownMenuItem disabled={!canCheckIn} onSelect={async () => seatToast(await run("CHECK_IN", { registrationId: r.id, createEntry: true, seat: "AUTO" }), r.playerName)}>
                        <Check /> {t("Check in and seat")}
                      </DropdownMenuItem>
                    )}
                    {r.status === "CHECKED_IN" && (
                      <DropdownMenuItem onSelect={() => run("UNDO_CHECK_IN", { registrationId: r.id }, { success: t("Check-in undone") })}>
                        <Undo2 /> {t("Undo check-in")}
                      </DropdownMenuItem>
                    )}
                    {r.status === "WAITLISTED" && (
                      <DropdownMenuItem onSelect={() => run("PROMOTE_WAITLIST", { registrationId: r.id }, { success: t("Promoted from the waitlist") })}>
                        <ListPlus /> {t("Promote")}
                      </DropdownMenuItem>
                    )}
                    {(r.status === "REGISTERED" || r.status === "RESERVED") && (
                      <DropdownMenuItem onSelect={() => run("MARK_NO_SHOW", { registrationId: r.id }, { success: t("Marked as no-show") })}>
                        <UserRoundX /> {t("Mark no-show")}
                      </DropdownMenuItem>
                    )}
                    {["REGISTERED", "RESERVED", "WAITLISTED", "CHECKED_IN"].includes(r.status) && (
                      <DropdownMenuItem destructive onSelect={() => run("CANCEL_REGISTRATION", { registrationId: r.id }, { success: t("Registration cancelled") })}>
                        <Ban /> {t("Cancel registration")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={quickAdd} onOpenChange={setQuickAdd}>
        <DialogContent>
          <form onSubmit={quickCreate} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>{t("Quick add player")}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("First name")}>
                <Input autoFocus required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </Field>
              <Field label={t("Last name")}>
                <Input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </Field>
              <Field label={t("Nickname")}>
                <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
              </Field>
              <Field label={t("Phone")}>
                <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>
            <Field label={t("Email")}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <DialogFooter>
              <Button type="submit" size="lg" loading={adding}>
                <UserPlus /> {canCheckIn ? t("Create, check in and seat") : t("Create and register")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
