"use client";

import { Badge, Button, Card, Checkbox, Chip, Field, Select, Textarea } from "@pcos/ui";
import { Megaphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCan } from "@/components/staff-guard";
import { ApiError, post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { useFloor } from "./floor-context";

/** One announcement fans out to TVs, live pages and (asynchronously) Telegram (spec §30, §70). */
export function AnnouncementsPanel() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const { snapshot } = useFloor();
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("INFO");
  const [channels, setChannels] = useState<string[]>(["DISPLAY", "PLAYER_LIVE"]);
  const [minutes, setMinutes] = useState("5");
  const [busy, setBusy] = useState(false);
  const presets = [t("Registration closes at the end of this level."), t("Break: 10 minutes."), t("Final table — please stay close to your seat."), t("Add-on available now at the cashier.")];
  const toggle = (c: string) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/api/v1/announcements", { tournamentId: snapshot.tournament.id, body, severity, channels, displaySeconds: Math.max(5, Math.round(Number(minutes) * 60)) });
      toast.success(t("Announcement published"));
      setBody("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-4">
        <form onSubmit={send} className="grid gap-3">
          <Field label={t("Announcement")}>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} required rows={3} className="text-base" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Chip key={p} active={body === p} onClick={() => setBody(p)} className="h-auto min-h-8 whitespace-normal py-1.5 text-left pointer-coarse:h-auto pointer-coarse:min-h-10">
                {p}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label={t("Severity")}>
              <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="INFO">{t("Info")}</option>
                <option value="WARNING">{t("Warning")}</option>
                <option value="CRITICAL">{t("Critical")}</option>
              </Select>
            </Field>
            <Field label={t("Show on screens (minutes)")}>
              <Select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                {["1", "2", "5", "10", "20", "60"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Checkbox label={t("TV displays")} checked={channels.includes("DISPLAY")} onChange={() => toggle("DISPLAY")} />
            <Checkbox label={t("Player live pages")} checked={channels.includes("PLAYER_LIVE")} onChange={() => toggle("PLAYER_LIVE")} />
            {can("telegram.announce") && <Checkbox label="Telegram" checked={channels.includes("TELEGRAM")} onChange={() => toggle("TELEGRAM")} />}
          </div>
          {channels.includes("TELEGRAM") && <p className="text-xs text-muted-foreground">{t("Telegram delivery is asynchronous and waits for the Internet; local screens update immediately.")}</p>}
          <Button type="submit" size="lg" loading={busy} disabled={!body.trim() || channels.length === 0}>
            <Megaphone /> {t("Publish announcement")}
          </Button>
        </form>
      </Card>
      <Card className="p-4">
        <div className="mb-3 text-sm font-medium">{t("Announcements")}</div>
        <div className="grid gap-2">
          {snapshot.announcements.length === 0 && <p className="text-sm text-muted-foreground">{t("No announcements yet.")}</p>}
          {snapshot.announcements.map((a) => (
            <div key={a.id} className="rounded-md border border-border p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                {fmt.time(a.createdAt)}
                <Badge variant={a.severity === "CRITICAL" ? "destructive" : a.severity === "WARNING" ? "warning" : "secondary"}>{a.severity}</Badge>
                {a.channels.map((c) => (
                  <Badge key={c} variant="outline">
                    {c}
                  </Badge>
                ))}
              </div>
              {a.body}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
