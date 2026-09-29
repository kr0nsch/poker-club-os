import { slugify as baseSlugify } from "@pcos/types";
// Small pure helpers shared by the configuration pages.

type T = (text: string, vars?: Record<string, string | number | null | undefined>) => string;

// --- money (the API stores integer cents; staff type currency units) --------------------------

/** "12.50" / "12,5" → 1250; "" → null; malformed → NaN. */
export function unitsToCents(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number.parseFloat(s) * 100);
}

export function centsToUnits(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

// --- integers ----------------------------------------------------------------------------------

/** "" → null; non-integer → NaN. */
export function parseIntOrNull(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) return Number.NaN;
  return Number.parseInt(s, 10);
}

export const intToField = (n: number | null | undefined) => (n == null ? "" : String(n));

// --- date & time (datetime-local inputs are in the device time zone) ---------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-09-28T19:00" (local) → ISO string; "" → null; invalid → "invalid". */
export function localInputToIso(value: string): string | null | "invalid" {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

/** Today (local) as YYYY-MM-DD. */
export function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Next full hour from now, as a datetime-local value. */
export function nextHourLocalInput(hoursAhead = 1): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + hoursAhead);
  return isoToLocalInput(d.toISOString());
}

export const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
};

// --- durations ----------------------------------------------------------------------------------

/** 7500 → "2h 5m" (translated). */
export function formatDuration(totalSeconds: number, t: T): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? t("{h}h {m}m", { h, m }) : t("{h}h", { h });
  if (m > 0) return sec > 0 ? t("{m}m {s}s", { m, s: sec }) : t("{m}m", { m });
  return t("{s}s", { s: sec });
}

/** Clock-style offset from the start: 4800 → "1:20". */
export function formatOffset(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}`;
}

// --- comparison ----------------------------------------------------------------------------------

/** JSON with sorted object keys, for order-independent equality checks. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

export const sameValue = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/**
 * Three-way comparison of flat records (field → value) used for optimistic
 * concurrency: which fields did I change, and which of those were also changed
 * (differently) by someone else since my base version.
 */
export function threeWay<K extends string>(base: Partial<Record<K, unknown>>, mine: Partial<Record<K, unknown>>, theirs: Partial<Record<K, unknown>>, fields: readonly K[]) {
  const changedByMe = fields.filter((k) => !sameValue(mine[k], base[k]));
  const changedByThem = fields.filter((k) => !sameValue(theirs[k], base[k]));
  const conflicts = changedByMe.filter((k) => changedByThem.includes(k) && !sameValue(mine[k], theirs[k]));
  return { changedByMe, changedByThem, conflicts };
}

export function pick<V, K extends string>(obj: Partial<Record<K, V>>, keys: readonly K[]): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// --- misc ----------------------------------------------------------------------------------------

export function ordinal(n: number, locale: string): string {
  if (locale === "ru") return `${n}-е`;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function slugify(s: string): string {
  return baseSlugify(s, 64);
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
