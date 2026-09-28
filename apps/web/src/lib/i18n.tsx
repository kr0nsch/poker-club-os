"use client";

// gettext-style i18n: the English text is the key; Russian translations live
// in a dictionary. Missing translations fall back to English.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ru } from "./i18n-ru";

export type Locale = "en" | "ru";
const KEY = "pcos.locale";

type Vars = Record<string, string | number | null | undefined>;

function interpolate(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? "" : String(vars[k])));
}

interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  t(text: string, vars?: Vars): string;
}

const Ctx = createContext<I18n>({ locale: "en", setLocale: () => undefined, t: (s, v) => interpolate(s, v) });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Locale | null;
      const initial = saved ?? (navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en");
      setLocaleState(initial);
      document.documentElement.lang = initial;
    } catch {
      /* ignore */
    }
  }, []);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback((text: string, vars?: Vars) => interpolate(locale === "ru" ? (ru[text] ?? text) : text, vars), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/** Locale-aware formatting helpers. */
export function useFormat() {
  const { locale } = useI18n();
  const tag = locale === "ru" ? "ru-RU" : "en-GB";
  return useMemo(
    () => ({
      number: (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString(tag)),
      dateTime: (iso: string | Date | null | undefined) =>
        iso ? new Date(iso).toLocaleString(tag, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—",
      date: (iso: string | Date | null | undefined) => (iso ? new Date(iso).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" }) : "—"),
      time: (iso: string | Date | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" }) : "—"),
      money: (cents: number | null | undefined, currency = "EUR") =>
        cents == null ? "—" : (cents / 100).toLocaleString(tag, { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }),
      relative: (iso: string | null | undefined) => {
        if (!iso) return "—";
        const diff = (new Date(iso).getTime() - Date.now()) / 1000;
        const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
        const abs = Math.abs(diff);
        if (abs < 60) return rtf.format(Math.round(diff), "second");
        if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
        return rtf.format(Math.round(diff / 86400), "day");
      },
    }),
    [tag],
  );
}
