"use client";

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@pcos/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { MeView } from "@pcos/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Brand, LanguageSwitch } from "@/components/brand";
import { ApiError, post, setCsrfToken } from "@/lib/api";
import { homeFor } from "@/lib/home";
import { useT } from "@/lib/i18n";
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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("Sign in")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <Field label={t("Email")} htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t("Password")} htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" loading={busy}>
            {t("Sign in")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  const t = useT();
  return (
    <main className="felt flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <Brand className="text-lg" />
      <Suspense>
        <LoginForm />
      </Suspense>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          {t("Back")}
        </Link>
        <LanguageSwitch />
      </div>
    </main>
  );
}
