// Message rendering per notification type. Concise by design (spec §24): the
// canonical details stay in the web application.

import type { NotificationType } from "@pcos/types";

export interface RenderedMessage {
  title: string;
  /** plain text (email / SMS / push) */
  text: string;
  /** Telegram HTML (parse_mode=HTML) */
  html: string;
  /** optional deep link into the web app */
  url?: string;
}

type P = Record<string, unknown>;
type Locale = "en" | "ru";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function when(iso: unknown, locale: Locale, tz?: unknown): string {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  try {
    return d.toLocaleString(locale === "ru" ? "ru-RU" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: typeof tz === "string" ? tz : undefined,
    });
  } catch {
    return d.toISOString();
  }
}

const T: Record<NotificationType, Record<Locale, (p: P) => { title: string; body: string }>> = {
  REGISTRATION_CONFIRMED: {
    en: (p) => ({
      title: "Registration confirmed",
      body: p.status === "WAITLISTED" ? `You are on the waitlist (#${p.waitlistPosition}) for ${p.tournamentName}.` : `You are registered for ${p.tournamentName} — ${p.startLabel}.`,
    }),
    ru: (p) => ({
      title: "Регистрация подтверждена",
      body: p.status === "WAITLISTED" ? `Вы в листе ожидания (№${p.waitlistPosition}) на ${p.tournamentName}.` : `Вы зарегистрированы на ${p.tournamentName} — ${p.startLabel}.`,
    }),
  },
  REGISTRATION_CANCELLED: {
    en: (p) => ({ title: "Registration cancelled", body: `Your registration for ${p.tournamentName} was cancelled.` }),
    ru: (p) => ({ title: "Регистрация отменена", body: `Ваша регистрация на ${p.tournamentName} отменена.` }),
  },
  TOURNAMENT_REMINDER: {
    en: (p) => ({ title: "Tournament reminder", body: `${p.tournamentName} starts ${p.startLabel}. See you at the tables!` }),
    ru: (p) => ({ title: "Напоминание о турнире", body: `${p.tournamentName} начинается ${p.startLabel}. Ждём вас за столами!` }),
  },
  TOURNAMENT_CHANGED: {
    en: (p) => ({ title: "Tournament changed", body: `${p.tournamentName} was updated${p.startLabel ? `: now starts ${p.startLabel}` : ""}.` }),
    ru: (p) => ({ title: "Изменения в турнире", body: `${p.tournamentName} изменён${p.startLabel ? `: начало ${p.startLabel}` : ""}.` }),
  },
  TOURNAMENT_CANCELLED: {
    en: (p) => ({ title: "Tournament cancelled", body: `${p.tournamentName} has been cancelled.${p.reason ? ` Reason: ${p.reason}` : ""}` }),
    ru: (p) => ({ title: "Турнир отменён", body: `${p.tournamentName} отменён.${p.reason ? ` Причина: ${p.reason}` : ""}` }),
  },
  REGISTRATION_OPENING: {
    en: (p) => ({ title: "Registration open", body: `Registration for ${p.tournamentName} (${p.startLabel}) is now open.` }),
    ru: (p) => ({ title: "Открыта регистрация", body: `Открыта регистрация на ${p.tournamentName} (${p.startLabel}).` }),
  },
  LATE_REGISTRATION_CLOSING: {
    en: (p) => ({ title: "Late registration closing", body: `Late registration for ${p.tournamentName} closes in about ${p.minutes} minutes.` }),
    ru: (p) => ({ title: "Поздняя регистрация закрывается", body: `Поздняя регистрация на ${p.tournamentName} закроется примерно через ${p.minutes} мин.` }),
  },
  SEAT_ASSIGNED: {
    en: (p) => ({ title: "Your seat", body: `${p.tournamentName}: table ${p.tableNumber}, seat ${p.seatNumber}.` }),
    ru: (p) => ({ title: "Ваше место", body: `${p.tournamentName}: стол ${p.tableNumber}, место ${p.seatNumber}.` }),
  },
  TABLE_MOVE: {
    en: (p) => ({ title: "Table move", body: `Please move to table ${p.tableNumber}, seat ${p.seatNumber} (${p.tournamentName}).` }),
    ru: (p) => ({ title: "Пересадка", body: `Пожалуйста, пересядьте за стол ${p.tableNumber}, место ${p.seatNumber} (${p.tournamentName}).` }),
  },
  RESULTS_FINALIZED: {
    en: (p) => ({ title: "Results", body: `${p.tournamentName}: you finished #${p.position} of ${p.players}${p.points != null ? ` (${p.points} pts)` : ""}.` }),
    ru: (p) => ({ title: "Итоги турнира", body: `${p.tournamentName}: ваше место — ${p.position} из ${p.players}${p.points != null ? ` (${p.points} очк.)` : ""}.` }),
  },
  LEAGUE_POSITION_CHANGED: {
    en: (p) => ({ title: "League standings", body: `You are now #${p.rank} in ${p.leagueName ?? "the league"} with ${p.points} points.` }),
    ru: (p) => ({ title: "Рейтинг лиги", body: `Теперь вы на ${p.rank}-м месте в ${p.leagueName ?? "лиге"}: ${p.points} очк.` }),
  },
  ANNOUNCEMENT: {
    en: (p) => ({ title: p.tournamentName ? String(p.tournamentName) : "Announcement", body: String(p.body ?? "") }),
    ru: (p) => ({ title: p.tournamentName ? String(p.tournamentName) : "Объявление", body: String(p.body ?? "") }),
  },
  STAFF_ALERT: {
    en: (p) => ({ title: `${p.severity ?? "INFO"}: ${p.title ?? "System alert"}`, body: String(p.body ?? "") }),
    ru: (p) => ({ title: `${p.severity ?? "INFO"}: ${p.title ?? "Системное уведомление"}`, body: String(p.body ?? "") }),
  },
};

export function renderNotification(type: NotificationType, payload: P, localeRaw?: string | null): RenderedMessage {
  const locale: Locale = localeRaw?.startsWith("ru") ? "ru" : "en";
  const p = { ...payload, startLabel: payload.startAt ? when(payload.startAt, locale, payload.timezone) : payload.startLabel };
  const { title, body } = T[type][locale](p);
  const icon = type === "TABLE_MOVE" || type === "SEAT_ASSIGNED" ? "🪑 " : type === "STAFF_ALERT" ? "⚠️ " : type === "RESULTS_FINALIZED" ? "🏆 " : "♠️ ";
  return {
    title,
    text: `${title}\n${body}`,
    html: `${icon}<b>${esc(title)}</b>\n${esc(body)}`,
    url: typeof payload.url === "string" ? payload.url : undefined,
  };
}
