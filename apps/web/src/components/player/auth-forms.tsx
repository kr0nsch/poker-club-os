"use client";

import type { MeView } from "@pcos/types";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Field, Input } from "@pcos/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, post, setCsrfToken } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { keys } from "@/lib/queries";
import { playerKeys, safeNext, usePlayerSession } from "./api";
import { useFriendlyError } from "./labels";

function useAfterAuth(org: string) {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), `/p/${org}`);
  return {
    next,
    done(me: MeView) {
      setCsrfToken(me.csrfToken);
      qc.setQueryData(keys.me, me);
      void qc.invalidateQueries({ queryKey: playerKeys.all });
      void qc.invalidateQueries({ queryKey: ["live"] });
      router.replace(next);
    },
  };
}

function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 pr-11 text-base"
        aria-invalid={invalid || undefined}
        required
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
        aria-label={show ? t("Hide password") : t("Show password")}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function SignedInNotice({ org, next }: { org: string; next: string }) {
  const t = useT();
  const { player } = usePlayerSession(org);
  if (!player) return null;
  return (
    <Alert variant="success" title={t("You are signed in as {name}", { name: player.displayName })}>
      <Button asChild size="sm" className="mt-2">
        <Link href={next}>{t("Continue")}</Link>
      </Button>
    </Alert>
  );
}

export function LoginForm({ org }: { org: string }) {
  const t = useT();
  const friendly = useFriendlyError();
  const { next, done } = useAfterAuth(org);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      done(await post<MeView>("/api/v1/auth/login", { email: email.trim(), password, organizationSlug: org }));
    } catch (err) {
      setError(err instanceof ApiError && err.code === "UNAUTHENTICATED" ? t("Wrong email or password.") : friendly(err).title);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      <SignedInNotice org={org} next={next} />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("Sign in")}</CardTitle>
          <CardDescription>{t("Use the email and password of your player account.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            {error && <Alert variant="destructive">{error}</Alert>}
            <Field label={t("Email")} htmlFor="email">
              <Input id="email" type="email" inputMode="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 text-base" />
            </Field>
            <Field label={t("Password")} htmlFor="password">
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <Button type="submit" size="lg" loading={busy}>
              {t("Sign in")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("Forgot your password? Ask the registration desk to help you.")}</p>
          </form>
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        {t("New here?")}{" "}
        <Link href={`/p/${org}/signup?next=${encodeURIComponent(next)}`} className="inline-flex min-h-10 items-center font-medium text-gold underline-offset-4 hover:underline">
          {t("Create a player account")}
        </Link>
      </p>
    </div>
  );
}

interface SignupFields {
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  phone: string;
  password: string;
  marketingConsent: boolean;
  acceptPrivacyPolicy: boolean;
}

const EMPTY: SignupFields = { firstName: "", lastName: "", nickname: "", email: "", phone: "", password: "", marketingConsent: false, acceptPrivacyPolicy: false };

export function SignupForm({ org }: { org: string }) {
  const t = useT();
  const friendly = useFriendlyError();
  const { next, done } = useAfterAuth(org);
  const [v, setV] = useState<SignupFields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof SignupFields, string>>>({});
  const [error, setError] = useState<{ text: string; duplicate?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SignupFields>(k: K, value: SignupFields[K]) => setV((p) => ({ ...p, [k]: value }));

  function validate(): boolean {
    const e: Partial<Record<keyof SignupFields, string>> = {};
    if (!v.firstName.trim()) e.firstName = t("Required");
    if (!v.lastName.trim()) e.lastName = t("Required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = t("Enter a valid email address");
    if (v.phone.trim() && !/^[+0-9 ()-]{3,32}$/.test(v.phone.trim())) e.phone = t("Digits, spaces, +, - and ( ) only");
    if (v.password.length < 10) e.password = t("At least 10 characters");
    if (!v.acceptPrivacyPolicy) e.acceptPrivacyPolicy = t("Please accept the privacy policy to continue");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const me = await post<MeView>("/api/v1/auth/signup", {
        organizationSlug: org,
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        nickname: v.nickname.trim() || undefined,
        email: v.email.trim(),
        phone: v.phone.trim() || undefined,
        password: v.password,
        marketingConsent: v.marketingConsent,
        acceptPrivacyPolicy: true,
      });
      done(me);
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE") setError({ text: t("An account with this email already exists."), duplicate: true });
      else if (err instanceof ApiError && err.code === "FEATURE_DISABLED") setError({ text: t("Online sign-up is disabled at this club. Please ask the registration desk.") });
      else setError({ text: friendly(err).title });
    } finally {
      setBusy(false);
    }
  }

  const text = (k: "firstName" | "lastName" | "nickname" | "email" | "phone", label: string, props: React.InputHTMLAttributes<HTMLInputElement>, hint?: string) => (
    <Field label={label} htmlFor={k} error={errors[k]} hint={hint}>
      <Input id={k} value={v[k]} onChange={(e) => set(k, e.target.value)} className="h-11 text-base" aria-invalid={!!errors[k] || undefined} {...props} />
    </Field>
  );

  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      <SignedInNotice org={org} next={next} />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("Create a player account")}</CardTitle>
          <CardDescription>{t("Register for tournaments, get your check-in QR code and see your seat on your phone.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            {error && (
              <Alert variant="destructive">
                {error.text}
                {error.duplicate && (
                  <Link href={`/p/${org}/login?next=${encodeURIComponent(next)}`} className="ml-1 font-medium text-primary underline">
                    {t("Sign in")}
                  </Link>
                )}
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3">
              {text("firstName", t("First name"), { autoComplete: "given-name", required: true, maxLength: 80 })}
              {text("lastName", t("Last name"), { autoComplete: "family-name", required: true, maxLength: 80 })}
            </div>
            {text("nickname", t("Nickname (optional)"), { autoComplete: "nickname", maxLength: 40 }, t("Shown on seating lists and results instead of your name."))}
            {text("email", t("Email"), { type: "email", inputMode: "email", autoComplete: "email", required: true, maxLength: 254 })}
            {text("phone", t("Phone (optional)"), { type: "tel", inputMode: "tel", autoComplete: "tel", maxLength: 32 })}
            <Field label={t("Password")} htmlFor="password" error={errors.password} hint={t("At least 10 characters")}>
              <PasswordInput id="password" value={v.password} onChange={(p) => set("password", p)} autoComplete="new-password" invalid={!!errors.password} />
            </Field>
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <Checkbox
                checked={v.acceptPrivacyPolicy}
                onChange={(e) => set("acceptPrivacyPolicy", e.target.checked)}
                label={t("I accept the club's privacy policy (required)")}
                className="items-start [&_input]:mt-0.5"
              />
              {errors.acceptPrivacyPolicy && <p className="-mt-1 text-xs text-destructive">{errors.acceptPrivacyPolicy}</p>}
              <Checkbox
                checked={v.marketingConsent}
                onChange={(e) => set("marketingConsent", e.target.checked)}
                label={t("Send me news about tournaments and events (optional)")}
                className="items-start [&_input]:mt-0.5"
              />
            </div>
            <Button type="submit" size="lg" loading={busy}>
              {t("Create account")}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        {t("Already have an account?")}{" "}
        <Link href={`/p/${org}/login?next=${encodeURIComponent(next)}`} className="inline-flex min-h-10 items-center font-medium text-gold underline-offset-4 hover:underline">
          {t("Sign in")}
        </Link>
      </p>
    </div>
  );
}
