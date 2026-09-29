"use client";

import type { MeView } from "@pcos/types";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner } from "@pcos/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Spade } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { LanguageSwitch } from "@/components/brand";
import { ApiError, post, setCsrfToken } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { keys } from "@/lib/queries";

interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}

const webApp = () => (typeof window === "undefined" ? null : ((window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null));

type Phase = "loading" | "signing-in" | "not-telegram" | "not-linked" | "disabled" | "offline" | "error";

/**
 * Telegram Mini App entry (spec §26): Telegram signs `initData`, the edge
 * server verifies it and opens a normal player session; the player PWA is
 * reused as-is. The Telegram script itself needs the Internet.
 */
export default function TelegramMiniAppPage() {
  const { org } = useParams<{ org: string }>();
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const start = useCallback(async () => {
    const app = webApp();
    if (!app?.initData) {
      setPhase("not-telegram");
      return;
    }
    if (started.current) return;
    started.current = true;
    try {
      app.ready();
      app.expand();
      app.setHeaderColor?.("#07100d");
      app.setBackgroundColor?.("#07100d");
    } catch {
      /* older Telegram clients */
    }
    setPhase("signing-in");
    try {
      const me = await post<MeView>("/api/v1/auth/telegram-miniapp", { organizationSlug: org, initData: app.initData });
      setCsrfToken(me.csrfToken);
      qc.setQueryData(keys.me, me);
      router.replace(`/p/${org}`);
    } catch (e) {
      started.current = false;
      if (e instanceof ApiError && e.code === "FORBIDDEN") setPhase("not-linked");
      else if (e instanceof ApiError && e.code === "FEATURE_DISABLED") setPhase("disabled");
      else if (e instanceof ApiError && e.isNetwork) setPhase("offline");
      else {
        setMessage(e instanceof Error ? e.message : null);
        setPhase("error");
      }
    }
  }, [org, qc, router]);

  // The script may never load (no Internet, or opened in a normal browser).
  useEffect(() => {
    const id = setTimeout(() => setPhase((p) => (p === "loading" ? (webApp() ? p : "not-telegram") : p)), 8_000);
    return () => clearTimeout(id);
  }, []);

  const web = `/p/${org}`;
  let content;
  switch (phase) {
    case "loading":
    case "signing-in":
      content = (
        <div className="grid justify-items-center gap-3 py-6">
          <Spinner className="[&_svg]:size-6" label={phase === "loading" ? t("Opening…") : t("Signing you in…")} />
        </div>
      );
      break;
    case "not-linked":
      content = (
        <div className="grid gap-4 text-sm">
          <p>{t("Your Telegram account is not linked to a player profile of this club yet.")}</p>
          <ol className="grid list-decimal gap-2 pl-5 text-muted-foreground">
            <li>{t("Send /link to the club's bot: it replies with an 8-character code.")}</li>
            <li>{t("Sign in on the club website and enter the code under Profile → Telegram.")}</li>
            <li>{t("Open the Mini App again.")}</li>
          </ol>
          <Button asChild size="lg">
            <Link href={`/p/${org}/login?next=${encodeURIComponent(`/p/${org}/me`)}`}>{t("Sign in on the website")}</Link>
          </Button>
        </div>
      );
      break;
    case "disabled":
      content = <Alert variant="warning">{t("Signing in with Telegram is not enabled at this club.")}</Alert>;
      break;
    case "not-telegram":
      content = (
        <div className="grid gap-4 text-sm">
          <p className="text-muted-foreground">{t("This page works inside Telegram. Open it from the Mini App button of the club's bot, or continue in the browser.")}</p>
          <Button asChild size="lg">
            <Link href={web}>{t("Continue in the browser")}</Link>
          </Button>
        </div>
      );
      break;
    case "offline":
    case "error":
      content = (
        <div className="grid gap-4">
          <Alert variant="destructive" title={phase === "offline" ? t("Local server unreachable") : t("Telegram sign-in failed")}>
            {phase === "error" ? message : null}
          </Alert>
          <Button size="lg" onClick={() => void start()}>
            {t("Try again")}
          </Button>
          <Button asChild variant="outline">
            <Link href={web}>{t("Continue in the browser")}</Link>
          </Button>
        </div>
      );
      break;
  }

  return (
    <main className="felt flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={() => void start()} onError={() => setPhase((p) => (p === "loading" ? "not-telegram" : p))} />
      <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <Spade className="size-8" fill="currentColor" />
      </span>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Send className="size-5 text-sky-400" /> Telegram
          </CardTitle>
          <CardDescription>{t("Poker Club")}</CardDescription>
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
      <LanguageSwitch />
    </main>
  );
}
