"use client";

import { Alert, Button, Field, Input } from "@pcos/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { MeView } from "@pcos/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Brand, LanguageSwitch, SpadeMark } from "@/components/brand";
import { ApiError, post, setCsrfToken } from "@/lib/api";
import { homeFor } from "@/lib/home";
import { useFormat, useI18n, useT } from "@/lib/i18n";
import { keys } from "@/lib/queries";

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await post<MeView>("/api/v1/auth/login", { email, password });
      setCsrfToken(me.csrfToken);
      qc.setQueryData(keys.me, me);
      const next = params.get("next");
      // Only same-site relative paths are accepted as a redirect target (no open redirect).
      if (next && next.startsWith("/") && !next.startsWith("//")) router.replace(next);
      else router.replace(homeFor(me));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      <Field label={t("Email")} htmlFor="email">
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
      </Field>
      <Field label={t("Password")} htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
      </Field>
      <Button type="submit" size="lg" className="mt-1" loading={busy}>
        {t("Sign in")}
      </Button>
    </form>
  );
}

/** Wall-clock for the brand panel; the venue runs on this time. */
function VenueClock() {
  const f = useFormat();
  const { locale } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <div className="h-16" />;
  return (
    <div>
      <div className="clock-digits text-6xl font-semibold leading-none">{f.time(now)}</div>
      <div className="mt-2 text-sm text-muted-foreground first-letter:uppercase">{now.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
    </div>
  );
}

/**
 * Staff sign-in. Wide screens split into a brand panel (what this system is, the venue clock) and a
 * quiet form; phones get a compact brand line above the form.
 */
export default function LoginPage() {
  const t = useT();
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card p-10 lg:flex xl:p-14">
        {/* A large spade, barely there, gives the panel its weight without a gradient or glow. */}
        <SpadeMark className="pointer-events-none absolute -bottom-24 -right-20 size-[34rem] text-gold/[0.045]" />
        <Brand className="relative text-lg" />
        <div className="relative max-w-xl">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">{t("Tournaments, tables and the clock of your club in one local system.")}</h1>
          <p className="mt-4 max-w-md text-lg text-muted-foreground">{t("Runs in the venue without the Internet: floor console, screens, kiosks and the player app.")}</p>
        </div>
        <div className="relative">
          <VenueClock />
        </div>
      </aside>

      <section className="flex flex-col px-6 py-8 sm:px-10">
        <div className="lg:hidden">
          <Brand className="text-lg" />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h2 className="text-2xl font-semibold tracking-tight">{t("Staff sign-in")}</h2>
          <p className="mb-7 mt-1.5 text-sm text-muted-foreground">{t("Use the account the club owner created for you.")}</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <Link href="/" className="inline-flex min-h-8 items-center transition-colors hover:text-foreground">
            {t("Back")}
          </Link>
          <LanguageSwitch />
        </div>
      </section>
    </main>
  );
}
