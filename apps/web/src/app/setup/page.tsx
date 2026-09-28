"use client";

import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@pcos/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { MeView } from "@pcos/types";
import { KeyRound, Network, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand, LanguageSwitch } from "@/components/brand";
import { ApiError, post, setCsrfToken } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { keys } from "@/lib/queries";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 40);

/** First-run setup (spec §101). Requires the one-time token printed on the edge server console. */
export default function SetupPage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    setupToken: "",
    orgName: "",
    orgSlug: "",
    venueName: "Main room",
    venueSlug: "main",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
    localHostname: "",
    edgeName: "Edge server",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const me = await post<MeView>("/api/v1/auth/setup", {
        setupToken: f.setupToken.trim(),
        organization: { name: f.orgName, slug: f.orgSlug || slugify(f.orgName) },
        venue: { name: f.venueName, slug: f.venueSlug || slugify(f.venueName), timezone: f.timezone, localHostname: f.localHostname || undefined },
        edgeNode: { name: f.edgeName },
        admin: { email: f.adminEmail, displayName: f.adminName, password: f.adminPassword },
      });
      setCsrfToken(me.csrfToken);
      qc.setQueryData(keys.me, me);
      router.replace("/admin/network?welcome=1");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      icon: KeyRound,
      title: t("Setup token"),
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            {t("For security, first-run setup requires the one-time token printed on the edge server console (docker compose logs api).")}
          </p>
          <Field label={t("Setup token")}>
            <Input value={f.setupToken} onChange={set("setupToken")} placeholder="XXXXXX-XXXXXX-XXXXXX" autoFocus className="font-mono uppercase" />
          </Field>
        </>
      ),
      valid: f.setupToken.trim().length >= 16,
    },
    {
      icon: Network,
      title: t("Club and venue"),
      body: (
        <>
          <Field label={t("Club name")}>
            <Input value={f.orgName} onChange={(e) => setF((p) => ({ ...p, orgName: e.target.value, orgSlug: slugify(e.target.value) }))} placeholder="Royal Poker Club" />
          </Field>
          <Field label={t("Short address (slug)")} hint={t("Used in player links, e.g. /p/{slug}", { slug: f.orgSlug || "royal" })}>
            <Input value={f.orgSlug} onChange={set("orgSlug")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Venue name")}>
              <Input value={f.venueName} onChange={(e) => setF((p) => ({ ...p, venueName: e.target.value, venueSlug: slugify(e.target.value) }))} />
            </Field>
            <Field label={t("Time zone")}>
              <Input value={f.timezone} onChange={set("timezone")} />
            </Field>
          </div>
          <Field label={t("Local hostname")} hint={t("Name staff devices use on the venue network, e.g. poker.royalclub.example (local DNS → this server)")}>
            <Input value={f.localHostname} onChange={set("localHostname")} placeholder="poker.club.example" />
          </Field>
          <Field label={t("Edge server name")}>
            <Input value={f.edgeName} onChange={set("edgeName")} />
          </Field>
        </>
      ),
      valid: f.orgName.length > 1 && /^[a-z0-9-]{2,}$/.test(f.orgSlug) && f.venueName.length > 0,
    },
    {
      icon: ShieldCheck,
      title: t("Owner account"),
      body: (
        <>
          <Field label={t("Name")}>
            <Input value={f.adminName} onChange={set("adminName")} autoComplete="name" />
          </Field>
          <Field label={t("Email")}>
            <Input type="email" value={f.adminEmail} onChange={set("adminEmail")} autoComplete="username" />
          </Field>
          <Field label={t("Password")} hint={t("At least 10 characters")}>
            <Input type="password" value={f.adminPassword} onChange={set("adminPassword")} autoComplete="new-password" />
          </Field>
        </>
      ),
      valid: f.adminName.length > 0 && f.adminEmail.includes("@") && f.adminPassword.length >= 10,
    },
  ];
  const current = steps[step]!;
  const Icon = current.icon;

  return (
    <main className="felt flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <Brand className="text-lg" />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {steps.map((s, i) => (
              <span key={i} className={i <= step ? "text-primary" : ""}>
                {i + 1}. {s.title}
                {i < steps.length - 1 && <span className="mx-1 text-muted-foreground">›</span>}
              </span>
            ))}
          </div>
          <CardTitle className="mt-2 flex items-center gap-2 text-xl">
            <Icon className="size-5 text-primary" /> {current.title}
          </CardTitle>
          <CardDescription>{t("Initial setup of the venue edge server")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          {current.body}
          <div className="mt-2 flex justify-between">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              {t("Back")}
            </Button>
            {step < steps.length - 1 ? (
              <Button disabled={!current.valid} onClick={() => setStep((s) => s + 1)}>
                {t("Continue")}
              </Button>
            ) : (
              <Button disabled={!current.valid} loading={busy} onClick={submit}>
                {t("Complete setup")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <LanguageSwitch />
    </main>
  );
}
