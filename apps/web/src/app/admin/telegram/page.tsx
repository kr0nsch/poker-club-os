"use client";

import { Alert, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Field, Input, Label, PageHeader, Select, Switch, cn } from "@pcos/ui";
import { TELEGRAM_MODES, type TelegramMode } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, CloudOff, KeyRound, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { lbl, useSysLabels } from "@/components/admin-system/labels";
import { NotificationQueueCard } from "@/components/admin-system/notification-queue";
import { sysKeys, useOrganization, useTelegramIntegration } from "@/components/admin-system/queries";
import type { TelegramIntegrationView } from "@/components/admin-system/types";
import { ErrorState, InfoList, InfoRow, NoAccess, RowsSkeleton } from "@/components/admin-system/ui";
import { useCan, useStaff } from "@/components/staff-guard";
import { post, put } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage, keys } from "@/lib/queries";
import { useRealtimeState } from "@/lib/realtime-context";

const USERNAME = /^[A-Za-z0-9_]{5,64}$/;
const TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID = /^-?\d{1,20}$/;

/** Telegram integration (spec §19-33): bot settings, status, security and the outgoing queue. */
export default function TelegramPage() {
  const t = useT();
  const can = useCan();
  const manage = can("telegram.manage");
  const integration = useTelegramIntegration(manage);
  const edge = useRealtimeState().edge;

  return (
    <div className="grid gap-6">
      <PageHeader
        className="mb-0"
        title="Telegram"
        description={t("Club bot for player notifications, registration and staff alerts. Delivery needs the Internet; everything else keeps working locally.")}
      />
      {!manage ? (
        <NoAccess permission="telegram.manage" />
      ) : (
        <>
          {edge && !edge.wanOnline && (
            <Alert variant="warning" title={t("Internet unavailable")}>
              <span className="flex items-start gap-2">
                <CloudOff className="mt-0.5 size-4 shrink-0" />
                {t("Telegram messages wait in the queue and are sent when the connection returns. Messages that become irrelevant in the meantime expire instead of arriving late.")}
              </span>
            </Alert>
          )}
          {integration.isLoading ? (
            <RowsSkeleton rows={6} />
          ) : integration.error ? (
            <ErrorState error={integration.error} onRetry={() => void integration.refetch()} />
          ) : integration.data ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <IntegrationCard data={integration.data} className="lg:col-span-2" />
              <div className="grid content-start gap-4">
                <StatusCard data={integration.data} />
                <SecurityCard />
              </div>
            </div>
          ) : null}
          <NotificationQueueCard />
        </>
      )}
    </div>
  );
}

function IntegrationCard({ data, className }: { data: TelegramIntegrationView; className?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(data.enabled);
  const [mode, setMode] = useState<TelegramMode>(data.mode);
  const [username, setUsername] = useState(data.botUsername ?? "");
  // Write-only: the current token is never sent to the browser.
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(data.staffAlertsChatId ?? "");

  const cleanUsername = username.trim().replace(/^@/, "");
  const cleanToken = token.trim();
  const cleanChat = chatId.trim();
  const usernameError = cleanUsername && !USERNAME.test(cleanUsername) ? t("5–64 Latin letters, digits or underscores.") : null;
  const tokenError = cleanToken && !TOKEN.test(cleanToken) ? t("This does not look like a bot token (123456789:AA…).") : null;
  const chatError = cleanChat && !CHAT_ID.test(cleanChat) ? t("Use the numeric chat ID, e.g. -1001234567890.") : null;
  const needsToken = enabled && !data.tokenConfigured && !cleanToken;
  const dirty = enabled !== data.enabled || mode !== data.mode || cleanUsername !== (data.botUsername ?? "") || !!cleanToken || cleanChat !== (data.staffAlertsChatId ?? "");
  const valid = !usernameError && !tokenError && !chatError && !needsToken;

  const save = useMutation({
    mutationFn: () =>
      put<TelegramIntegrationView>("/api/v1/telegram/integration", {
        enabled,
        mode,
        // the API stores exactly what it receives, so always send the current values
        botUsername: cleanUsername || undefined,
        botToken: cleanToken || undefined,
        staffAlertsChatId: cleanChat || null,
      }),
    onSuccess: (res) => {
      qc.setQueryData(sysKeys.telegram, res);
      setToken("");
      if (res.botUsername) setUsername(res.botUsername);
      toast.success(t("Telegram settings saved"));
      if (res.status === "WAITING_FOR_NETWORK") toast.info(t("The token will be verified when the Internet is available."));
      // the "telegram" feature flag follows the enabled switch
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: sysKeys.organization });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const modeLabel: Record<TelegramMode, { label: string; hint: string }> = {
    EDGE_LONG_POLLING: { label: t("Edge long polling (recommended)"), hint: t("The edge server fetches updates from Telegram itself. No public address is needed.") },
    CLOUD_WEBHOOK: { label: t("Cloud webhook"), hint: t("Telegram calls the cloud gateway, which forwards updates to the edge server. Requires the cloud setup.") },
  };

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" /> {t("Bot settings")}
          </CardTitle>
          <CardDescription>{t("Create a bot with @BotFather, then enter its username and token here.")}</CardDescription>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
          {enabled ? t("Enabled") : t("Disabled")}
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("Enable Telegram")} />
        </label>
      </CardHeader>
      <CardContent>
        <form
          id="telegram-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && dirty) save.mutate();
          }}
        >
          <Field label={t("Mode")} hint={modeLabel[mode].hint}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as TelegramMode)}>
              {TELEGRAM_MODES.map((m) => (
                <option key={m} value={m}>
                  {modeLabel[m].label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("Bot username")} error={usernameError} hint={t("Filled in automatically when the token is verified.")}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                <Input value={username.replace(/^@/, "")} onChange={(e) => setUsername(e.target.value)} placeholder="royal_poker_bot" className="pl-7" aria-invalid={!!usernameError} maxLength={65} />
              </div>
            </Field>
            <Field
              label={t("Staff alerts chat ID")}
              error={chatError}
              hint={t("Group that receives staff alerts and the test message. Add the bot to the group and use its numeric ID.")}
            >
              <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" inputMode="numeric" className="font-mono" aria-invalid={!!chatError} maxLength={40} />
            </Field>
          </div>
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> {t("Bot token")}
              </span>
            }
            error={tokenError ?? (needsToken ? t("A bot token is required to enable Telegram.") : null)}
            hint={
              data.tokenConfigured
                ? data.tokenSource === "ENV"
                  ? t("Currently provided by the edge server environment (TELEGRAM_BOT_TOKEN). A token saved here takes precedence for this club.")
                  : t("Write-only. Leave empty to keep the current token; type a new one to replace it.")
                : t("From @BotFather. Stored encrypted on the edge server and never shown again.")
            }
          >
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={data.tokenConfigured ? t("•••••• configured") : "123456789:AA…"}
              autoComplete="new-password"
              spellCheck={false}
              className="font-mono"
              aria-invalid={!!tokenError || needsToken}
            />
          </Field>
        </form>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">{t("Unsaved changes")}</span>}
        <Button type="submit" form="telegram-form" disabled={!dirty || !valid} loading={save.isPending}>
          {t("Save")}
        </Button>
      </CardFooter>
    </Card>
  );
}

const STATUS_TONE: Record<string, "success" | "default" | "warning" | "destructive" | "muted"> = {
  ONLINE: "success",
  CONNECTING: "default",
  OFFLINE: "warning",
  WAITING_FOR_NETWORK: "warning",
  ERROR: "destructive",
  DISABLED: "muted",
};

function StatusCard({ data }: { data: TelegramIntegrationView }) {
  const t = useT();
  const fmt = useFormat();
  const L = useSysLabels();
  const statusText: Record<string, string> = {
    DISABLED: t("The integration is turned off."),
    CONNECTING: t("Connecting to Telegram…"),
    ONLINE: t("Connected. Messages are being delivered."),
    OFFLINE: t("Not connected. Messages wait in the queue."),
    WAITING_FOR_NETWORK: t("Waiting for the Internet. Messages wait in the queue."),
    ERROR: t("Telegram reported an error, see below."),
  };
  const test = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string }>("/api/v1/telegram/test"),
    onSuccess: (r) => (r.ok ? toast.success(t("Test message sent to the staff chat")) : toast.error(t("Telegram did not accept the test message"), { description: r.error })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canTest = data.enabled && data.tokenConfigured && !!data.staffAlertsChatId;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{t("Status")}</CardTitle>
          <CardDescription>{statusText[data.status] ?? data.status}</CardDescription>
        </div>
        <Badge variant={STATUS_TONE[data.status] ?? "outline"}>{lbl(L.telegramStatus, data.status)}</Badge>
      </CardHeader>
      <CardContent className="grid gap-4">
        <InfoList>
          <InfoRow label={t("Bot")}>{data.botUsername ? <span className="font-mono">@{data.botUsername}</span> : <span className="text-muted-foreground">{t("Not set")}</span>}</InfoRow>
          <InfoRow label={t("Token")}>
            {data.tokenConfigured ? (
              <span>
                <span className="text-success">{t("Configured")}</span>
                <span className="block text-xs text-muted-foreground">
                  {data.tokenSource === "ENV" ? t("From the edge server environment") : t("Stored encrypted on this server")}
                </span>
              </span>
            ) : (
              <span className="text-warning">{t("Not configured")}</span>
            )}
          </InfoRow>
          <InfoRow label={t("Last update")}>{data.lastUpdateAt ? <span title={fmt.dateTime(data.lastUpdateAt)}>{fmt.relative(data.lastUpdateAt)}</span> : "—"}</InfoRow>
          {data.lastError && (
            <InfoRow label={t("Last error")}>
              <span className="text-destructive">{data.lastError}</span>
            </InfoRow>
          )}
        </InfoList>
        <div className="grid gap-1.5">
          <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending} disabled={!canTest}>
            <Send /> {t("Send test message")}
          </Button>
          {!canTest && <p className="text-xs text-muted-foreground">{t("Enable the integration, save a token and a staff alerts chat ID first.")}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityCard() {
  const t = useT();
  const can = useCan();
  const me = useStaff();
  const org = useOrganization();
  const staffCommands = org.data?.settings.featureFlags.telegramStaffCommands ?? me.featureFlags?.telegramStaffCommands ?? false;
  const points = [
    t("The bot token never leaves the edge server: it is stored encrypted and is never shown again, sent to browsers or written to logs."),
    t("Players and staff are identified by their Telegram user ID, never by username."),
    t("State-changing staff commands (such as clock control) are disabled unless the “Telegram staff commands” feature flag is on."),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" /> {t("Security")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ul className="grid list-disc gap-1.5 pl-5 text-muted-foreground">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className={cn("flex items-center justify-between gap-2 rounded-lg border p-3", staffCommands ? "border-warning/50 bg-warning/10" : "border-border")}>
          <Label>{t("Telegram staff commands")}</Label>
          <Badge variant={staffCommands ? "warning" : "success"}>{staffCommands ? t("On") : t("Off")}</Badge>
        </div>
        {can("settings.manage") && (
          <Button asChild variant="link" size="sm" className="justify-self-start px-0">
            <Link href="/admin/settings#feature-flags">{t("Change in feature flags")}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
