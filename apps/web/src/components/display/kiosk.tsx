"use client";

import type { KioskCheckInInput } from "@pcos/types";
import { Button, cn, Spinner } from "@pcos/ui";
import { Armchair, Camera, CircleCheck, Delete, Hash, KeyRound, Keyboard, QrCode, Spade, TriangleAlert, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTournamentText } from "@/components/player/labels";
import { useLiveClock } from "@/components/player/live-clock";
import { ApiError, post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { useRealtimeState, useServerNow } from "@/lib/realtime-context";
import { CameraScanner, cameraScanSupported } from "./camera-scanner";
import { useIdleCursor, useVenueDevice, useWakeLock } from "./device-hooks";
import { isRevoked, useDeviceSnapshot, useDeviceState } from "./device-state";

type Mode = "qr" | "member" | "code";

interface CheckInResult {
  playerName: string;
  alreadyCheckedIn: boolean;
  seat: { tableNumber: number; seatNumber: number } | null;
  tournamentName: string;
  proceedToCashier?: boolean;
}

type Phase = { kind: "input" } | { kind: "busy" } | { kind: "done"; result: CheckInResult } | { kind: "error"; title: string; detail: string };

const RESULT_MS = 8_000;
const INACTIVITY_MS = 45_000;

/** Scanners may deliver a bare code or a URL/text containing it: take the last alphanumeric run. */
function normalizeScan(raw: string): string {
  const m = /([A-Za-z0-9]{6,64})[^A-Za-z0-9]*$/.exec(raw.trim());
  return (m?.[1] ?? raw.trim()).toUpperCase();
}

function Keypad({ onDigit, onBackspace, onClear, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; onClear: () => void; disabled?: boolean }) {
  const t = useT();
  const key = "grid h-[clamp(4rem,11vh,6.5rem)] place-items-center rounded-2xl text-4xl font-semibold transition-transform active:scale-95 disabled:opacity-40";
  // mousedown default is prevented so a physical keyboard keeps typing into the focused field
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="grid grid-cols-3 gap-3">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" disabled={disabled} onMouseDown={keep} onClick={() => onDigit(d)} className={cn(key, "bg-secondary tabular-nums hover:bg-secondary/80")}>
          {d}
        </button>
      ))}
      <button type="button" disabled={disabled} onMouseDown={keep} onClick={onClear} className={cn(key, "bg-muted text-xl text-muted-foreground")}>
        {t("Clear")}
      </button>
      <button type="button" disabled={disabled} onMouseDown={keep} onClick={() => onDigit("0")} className={cn(key, "bg-secondary tabular-nums hover:bg-secondary/80")}>
        0
      </button>
      <button type="button" disabled={disabled} onMouseDown={keep} onClick={onBackspace} className={cn(key, "bg-muted text-muted-foreground")} aria-label={t("Delete")}>
        <Delete className="size-9" />
      </button>
    </div>
  );
}

function BigField({ label, value, active, onFocus, mask, placeholder, inputRef, onChange, onEnter }: {
  label: string;
  value: string;
  active: boolean;
  onFocus: () => void;
  mask?: boolean;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange: (v: string) => void;
  onEnter?: () => void;
}) {
  return (
    <label className={cn("grid gap-2 rounded-2xl border-2 p-4 transition-colors", active ? "border-primary bg-primary/10" : "border-border bg-card")}>
      <span className="text-lg font-medium text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        value={mask ? "•".repeat(value.length) : value}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(e) => {
          if (mask) {
            // masked field: only accept appended digits / deletions from a physical keyboard
            const next = e.target.value;
            if (next.length < value.length) onChange(value.slice(0, next.length));
            else onChange(value + next.slice(value.length).replace(/\D/g, ""));
          } else onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        inputMode="none"
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-transparent font-mono text-5xl font-semibold tracking-[0.2em] outline-none placeholder:text-muted-foreground/40"
      />
    </label>
  );
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[clamp(4.5rem,10vh,6rem)] items-center justify-center gap-3 rounded-2xl border-2 px-4 text-xl font-semibold transition-colors [&_svg]:size-7",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground active:bg-accent",
      )}
    >
      {icon}
      <span className="text-left leading-tight">{label}</span>
    </button>
  );
}

/** Self check-in kiosk (spec §52): QR, member number + PIN, or one-time code. Huge targets, no way out. */
export function Kiosk({ token }: { token: string }) {
  const t = useT();
  const f = useFormat();
  const tt = useTournamentText();
  useVenueDevice("KIOSK");
  useWakeLock();
  const idleCursor = useIdleCursor(3_000);
  const state = useDeviceState(token);
  const s = state.data;
  const snap = useDeviceSnapshot(s);
  const v = useLiveClock(snap);
  const rt = useRealtimeState();
  const now = useServerNow(1_000);

  const [mode, setMode] = useState<Mode>("qr");
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [scan, setScan] = useState("");
  const [typing, setTyping] = useState(false);
  const [camera, setCamera] = useState(false);
  const [cameraOk, setCameraOk] = useState(false);
  const [member, setMember] = useState("");
  const [pin, setPin] = useState("");
  const [field, setField] = useState<"member" | "pin">("member");
  const [otc, setOtc] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const memberRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const otcRef = useRef<HTMLInputElement>(null);
  const lastActivity = useRef(0);

  useEffect(() => setCameraOk(cameraScanSupported()), []);

  const reset = useCallback(() => {
    setPhase({ kind: "input" });
    setMode("qr");
    setScan("");
    setTyping(false);
    setCamera(false);
    setMember("");
    setPin("");
    setField("member");
    setOtc("");
  }, []);

  // Result and error screens return to the start screen by themselves.
  useEffect(() => {
    if (phase.kind !== "done" && phase.kind !== "error") return;
    const id = setTimeout(reset, RESULT_MS);
    return () => clearTimeout(id);
  }, [phase, reset]);

  // Somebody walked away half-way through: clear their input.
  useEffect(() => {
    const touch = () => (lastActivity.current = Date.now());
    touch();
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current > INACTIVITY_MS) {
        lastActivity.current = Date.now();
        reset();
      }
    }, 5_000);
    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [reset]);

  // Keep the scanner field focused (USB/Bluetooth scanners type the code followed by Enter).
  useEffect(() => {
    if (phase.kind !== "input" || camera) return;
    const target = mode === "qr" ? scanRef.current : mode === "code" ? otcRef.current : field === "member" ? memberRef.current : pinRef.current;
    target?.focus({ preventScroll: true });
  }, [mode, phase.kind, camera, field, typing]);

  const submit = useCallback(
    async (body: KioskCheckInInput) => {
      setPhase({ kind: "busy" });
      try {
        const result = await post<CheckInResult>(`/api/v1/kiosk/${encodeURIComponent(token)}/check-in`, body);
        setPhase({ kind: "done", result });
      } catch (e) {
        const ask = t("Please ask the registration desk for help.");
        let title = t("Something went wrong");
        let detail = ask;
        if (e instanceof ApiError) {
          if (e.isNetwork) [title, detail] = [t("Connection problem"), t("The kiosk cannot reach the local server. Please try again in a moment.")];
          else if (e.code === "RATE_LIMITED") [title, detail] = [t("Too many attempts"), ask];
          else if (e.code === "FORBIDDEN")
            title = body.method === "MEMBER_PIN" ? t("Member number or PIN is incorrect") : body.method === "ONE_TIME_CODE" ? t("This code is invalid or has expired") : t("This code was not accepted");
          else if (e.code === "NOT_FOUND") [title, detail] = [t("No registration found"), t("We could not find your registration for this tournament. Please ask the registration desk.")];
          else if (e.code === "RULE_VIOLATION" || e.code === "INVALID_STATE") title = t("Check-in is not possible right now");
          else if (e.code === "UNAUTHENTICATED") [title, detail] = [t("This kiosk is not active"), t("Please ask the staff to set it up again.")];
          else if (e.code === "VALIDATION_ERROR") [title, detail] = [t("That code doesn't look right"), t("Please try again.")];
        }
        setPhase({ kind: "error", title, detail });
      }
    },
    [token, t],
  );

  const submitScan = (raw: string) => {
    const code = normalizeScan(raw);
    setScan("");
    if (code.length < 6) return;
    void submit({ method: "QR", code });
  };
  const submitMember = () => {
    if (!member.trim()) return setField("member");
    if (!/^\d{4,8}$/.test(pin)) return setField("pin");
    void submit({ method: "MEMBER_PIN", memberNumber: member.trim(), pin });
  };
  const typeOtc = (next: string) => {
    const code = next.replace(/\D/g, "").slice(0, 6);
    setOtc(code);
    if (code.length === 6) void submit({ method: "ONE_TIME_CODE", code });
  };
  const typeMember = (d: string) => {
    if (field === "member") setMember((m) => (m + d).slice(0, 32));
    else {
      const next = (pin + d).slice(0, 8);
      setPin(next);
    }
  };
  const switchMode = (m: Mode) => {
    setMode(m);
    setCamera(false);
    setTyping(false);
    setPhase({ kind: "input" });
  };

  if (!s) {
    const revoked = state.isError && isRevoked(state.error);
    return (
      <div className="grid h-dvh place-items-center bg-background p-8 text-center">
        <div className="grid justify-items-center gap-4">
          <Spade className="size-16 text-primary" fill="currentColor" />
          <div className="text-3xl font-semibold">{revoked ? t("This kiosk link is not valid") : t("Connecting to the local server…")}</div>
          {revoked && <div className="text-xl text-muted-foreground">{t("Please ask the staff to set it up again.")}</div>}
        </div>
      </div>
    );
  }

  const offline = rt.socket !== "open" || state.isError;
  const closed = !snap || v.finished || v.cancelled;

  return (
    <div
      className={cn("felt flex h-dvh select-none flex-col overflow-hidden text-foreground", idleCursor && "cursor-none")}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="flex items-center gap-4 border-b border-border bg-background/70 px-6 py-3 backdrop-blur">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Spade className="size-6" fill="currentColor" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-2xl font-semibold leading-tight">{snap?.tournament.name ?? s.organization?.name ?? ""}</div>
          <div className="truncate text-sm text-muted-foreground">{s.organization?.name}</div>
        </div>
        {snap && v.d && !v.notStarted && !closed && (
          <div className="text-right">
            <div className={cn("text-xs font-semibold uppercase tracking-widest", v.isBreak ? "text-gold" : "text-primary")}>
              {v.isBreak ? t("Break") : t("Level {n}", { n: v.d.playLevelNumber })}
              {v.paused && ` · ${t("Paused")}`}
            </div>
            <div className="flex items-baseline justify-end gap-3">
              {!v.isBreak && <span className="text-lg font-semibold tabular-nums text-foreground/80">{tt.blinds(v.level)}</span>}
              <span className={cn("clock-digits text-3xl font-bold", v.paused && "opacity-50")}>{v.d.formatted}</span>
            </div>
          </div>
        )}
        {snap && v.notStarted && !closed && <div className="text-lg text-muted-foreground">{t("Starts at {time}", { time: f.time(snap.tournament.startAt) })}</div>}
        <div className="flex items-center gap-2 pl-2 text-xl tabular-nums text-muted-foreground">
          {offline && <span className="size-3 animate-pulse rounded-full bg-destructive" title={t("Local server unreachable")} />}
          {f.time(new Date(now))}
        </div>
      </header>

      {closed ? (
        <main className="grid flex-1 place-items-center p-8 text-center">
          <div className="grid max-w-2xl justify-items-center gap-4">
            <CircleCheck className="size-20 text-muted-foreground" />
            <div className="text-4xl font-semibold">{t("Self check-in is not available right now")}</div>
            <div className="text-2xl text-muted-foreground">{t("Please ask the registration desk for help.")}</div>
          </div>
        </main>
      ) : phase.kind === "done" ? (
        <ResultScreen result={phase.result} seating={snap?.seating ?? null} onDone={reset} />
      ) : phase.kind === "error" ? (
        <main className="grid flex-1 place-items-center p-8 text-center" onClick={reset}>
          <div className="grid max-w-3xl justify-items-center gap-5">
            <span className="grid size-28 place-items-center rounded-full bg-warning/15 text-warning">
              <TriangleAlert className="size-16" />
            </span>
            <div className="text-5xl font-bold leading-tight">{phase.title}</div>
            <div className="text-2xl text-muted-foreground">{phase.detail}</div>
            <Button size="xl" className="mt-4 h-20 px-12 text-2xl" onClick={reset}>
              {t("Try again")}
            </Button>
            <Countdown ms={RESULT_MS} />
          </div>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">{t("Self check-in")}</h1>
            <p className="mt-1 text-xl text-muted-foreground">{t("Choose how you want to check in.")}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <ModeButton active={mode === "qr"} icon={<QrCode />} label={t("QR code")} onClick={() => switchMode("qr")} />
            <ModeButton active={mode === "member"} icon={<KeyRound />} label={t("Member number + PIN")} onClick={() => switchMode("member")} />
            <ModeButton active={mode === "code"} icon={<Hash />} label={t("One-time code")} onClick={() => switchMode("code")} />
          </div>

          {phase.kind === "busy" && (
            <div className="grid flex-1 place-items-center">
              <Spinner className="text-2xl [&_svg]:size-10" label={t("Checking you in…")} />
            </div>
          )}

          {phase.kind === "input" && mode === "qr" && (
            <div className="grid flex-1 content-center justify-items-center gap-6 text-center">
              {camera ? (
                <CameraScanner onCode={submitScan} onCancel={() => setCamera(false)} />
              ) : (
                <>
                  <div className="relative grid size-48 place-items-center rounded-3xl border-4 border-dashed border-primary/60 bg-primary/5">
                    <QrCode className="size-28 text-primary" />
                    <span className="absolute inset-x-6 top-1/2 h-1 animate-pulse rounded-full bg-primary/70" />
                  </div>
                  <div className="max-w-2xl text-3xl font-semibold leading-snug">{t("Hold your registration QR code in front of the scanner")}</div>
                </>
              )}
              <form
                className="flex w-full max-w-xl gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitScan(scan);
                }}
              >
                <input
                  ref={scanRef}
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onBlur={() => {
                    // re-focus so the next scan is not lost (unless the visitor is typing on the on-screen keyboard)
                    if (!typing) setTimeout(() => scanRef.current?.focus({ preventScroll: true }), 150);
                  }}
                  inputMode={typing ? "text" : "none"}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder={t("Registration code")}
                  aria-label={t("Registration code")}
                  className="h-16 min-w-0 flex-1 rounded-2xl border-2 border-border bg-background px-5 font-mono text-2xl uppercase tracking-[0.2em] outline-none focus:border-primary"
                />
                <Button type="submit" size="xl" className="h-16" disabled={normalizeScan(scan).length < 6}>
                  {t("Check in")}
                </Button>
              </form>
              <div className="flex flex-wrap justify-center gap-3">
                {!typing && (
                  <Button variant="outline" size="lg" className="h-14 text-lg" onClick={() => setTyping(true)}>
                    <Keyboard /> {t("Type the code")}
                  </Button>
                )}
                {cameraOk && !camera && (
                  <Button variant="outline" size="lg" className="h-14 text-lg" onClick={() => setCamera(true)}>
                    <Camera /> {t("Scan with the camera")}
                  </Button>
                )}
              </div>
            </div>
          )}

          {phase.kind === "input" && mode === "member" && (
            <div className="grid flex-1 content-center gap-6 lg:grid-cols-2 lg:items-center">
              <div className="grid gap-4">
                <BigField
                  label={t("Member number")}
                  value={member}
                  active={field === "member"}
                  onFocus={() => setField("member")}
                  inputRef={memberRef}
                  onChange={(x) => setMember(x.replace(/\s/g, "").slice(0, 32))}
                  onEnter={() => setField("pin")}
                  placeholder="0000"
                />
                <BigField label={t("PIN")} value={pin} active={field === "pin"} onFocus={() => setField("pin")} inputRef={pinRef} mask onChange={(x) => setPin(x.slice(0, 8))} onEnter={submitMember} />
                <Button size="xl" className="h-20 text-2xl" disabled={!member.trim() || !/^\d{4,8}$/.test(pin)} onClick={submitMember}>
                  {t("Check in")}
                </Button>
              </div>
              <Keypad
                onDigit={typeMember}
                onBackspace={() => (field === "member" ? setMember((m) => m.slice(0, -1)) : setPin((p) => p.slice(0, -1)))}
                onClear={() => (field === "member" ? setMember("") : setPin(""))}
              />
            </div>
          )}

          {phase.kind === "input" && mode === "code" && (
            <div className="grid flex-1 content-center gap-6 lg:grid-cols-2 lg:items-center">
              <div className="grid gap-4 text-center">
                <p className="text-2xl text-muted-foreground">{t("Enter the 6-digit code from the Profile page of the player app.")}</p>
                <div className="relative mx-auto">
                  <div className="flex gap-2" aria-hidden>
                    {Array.from({ length: 6 }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "grid h-24 w-16 place-items-center rounded-2xl border-2 text-5xl font-bold tabular-nums",
                          i === otc.length ? "border-primary bg-primary/10" : "border-border bg-card",
                        )}
                      >
                        {otc[i] ?? ""}
                      </span>
                    ))}
                  </div>
                  <input
                    ref={otcRef}
                    value={otc}
                    onChange={(e) => typeOtc(e.target.value)}
                    inputMode="none"
                    autoComplete="one-time-code"
                    aria-label={t("One-time code")}
                    className="absolute inset-0 opacity-0"
                  />
                </div>
              </div>
              <Keypad onDigit={(d) => typeOtc(otc + d)} onBackspace={() => setOtc((c) => c.slice(0, -1))} onClear={() => setOtc("")} />
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function Countdown({ ms }: { ms: number }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="mt-2 h-2 w-80 max-w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-primary/70 ease-linear" style={{ width: started ? "0%" : "100%", transition: `width ${ms}ms linear` }} />
    </div>
  );
}

function ResultScreen({ result, seating, onDone }: { result: CheckInResult; seating: { playerName: string; tableNumber: number; seatNumber: number }[] | null; onDone: () => void }) {
  const t = useT();
  // "Already checked in" responses carry no seat: look it up on the public seat list when the name is unique.
  const sameName = seating?.filter((r) => r.playerName === result.playerName) ?? [];
  const seat = result.seat ?? (result.alreadyCheckedIn && sameName.length === 1 && sameName[0] ? sameName[0] : null);
  return (
    <main className="grid flex-1 place-items-center p-8 text-center" onClick={onDone}>
      <div className="grid max-w-4xl justify-items-center gap-5">
        <span className="grid size-28 place-items-center rounded-full bg-primary/15 text-primary">
          <CircleCheck className="size-16" />
        </span>
        <div className="text-6xl font-bold leading-tight">{t("Welcome, {name}!", { name: result.playerName })}</div>
        {result.alreadyCheckedIn && <div className="text-3xl text-muted-foreground">{t("You are already checked in.")}</div>}
        {seat ? (
          <div className="mt-2 grid justify-items-center gap-2 rounded-3xl border-2 border-gold/60 bg-gold/10 px-14 py-8">
            <Armchair className="size-12 text-gold" />
            <div className="flex items-end gap-10 tabular-nums">
              <div>
                <div className="text-2xl font-semibold uppercase tracking-widest text-muted-foreground">{t("Table")}</div>
                <div className="text-[clamp(5rem,16vh,10rem)] font-black leading-none text-gold">{seat.tableNumber}</div>
              </div>
              <div>
                <div className="text-2xl font-semibold uppercase tracking-widest text-muted-foreground">{t("Seat")}</div>
                <div className="text-[clamp(5rem,16vh,10rem)] font-black leading-none text-gold">{seat.seatNumber}</div>
              </div>
            </div>
          </div>
        ) : result.proceedToCashier ? (
          <div className="mt-2 flex items-center gap-4 rounded-3xl border-2 border-warning/60 bg-warning/10 px-10 py-6 text-left">
            <Wallet className="size-14 shrink-0 text-warning" />
            <div className="text-3xl font-semibold leading-snug">{t("Please proceed to the cashier to complete your buy-in.")}</div>
          </div>
        ) : (
          !result.alreadyCheckedIn && <div className="text-3xl text-muted-foreground">{t("You are checked in. The floor staff will assign your seat.")}</div>
        )}
        <Button size="xl" className="mt-4 h-20 px-12 text-2xl" onClick={onDone}>
          {t("Done")}
        </Button>
        <Countdown ms={RESULT_MS} />
      </div>
    </main>
  );
}
