"use client";

// Localised labels for enums shown on the venue & system pages. Every literal
// goes through t() so that the Russian dictionary can be checked mechanically.

import type { DeviceType, DisplayWidget, FeatureFlag, NotificationType } from "@pcos/types";
import { useMemo } from "react";
import { useT } from "@/lib/i18n";

export function useSysLabels() {
  const t = useT();
  return useMemo(() => {
    const deviceType: Record<DeviceType, string> = {
      ADMIN_PC: t("Admin PC"),
      TD_TABLET: t("TD tablet"),
      FLOOR_PHONE: t("Floor phone"),
      DEALER_TABLET: t("Dealer tablet"),
      CASHIER: t("Cashier desk"),
      REGISTRATION_DESK: t("Registration desk"),
      DISPLAY: t("TV display"),
      KIOSK: t("Kiosk"),
      OTHER: t("Other"),
    };
    const widget: Record<DisplayWidget, string> = {
      CLOCK: t("Clock"),
      BLINDS: t("Blinds"),
      NEXT_LEVEL: t("Next level"),
      NEXT_BREAK: t("Next break"),
      ENTRIES: t("Entries"),
      REMAINING: t("Remaining"),
      AVERAGE_STACK: t("Average stack"),
      ANNOUNCEMENTS: t("Announcements"),
      LOGO: t("Logo"),
      SPONSOR: t("Sponsor"),
      LEADERBOARD: t("Leaderboard"),
      SEATING: t("Seating"),
      PRIZE_POOL: t("Prize pool"),
    };
    const featureFlag: Record<FeatureFlag, { label: string; description: string }> = {
      playerRegistration: { label: t("Player self-registration"), description: t("Players register for tournaments themselves on the player pages.") },
      qrRegistration: { label: t("QR registration"), description: t("QR codes that open registration and live pages on players' phones.") },
      telegram: { label: t("Telegram bot"), description: t("Notifications and registration through the club's Telegram bot. Switched together with the Telegram integration.") },
      telegramMiniApp: { label: t("Telegram Mini App"), description: t("Players sign in to the player pages inside Telegram.") },
      telegramStaffCommands: {
        label: t("Telegram staff commands"),
        description: t("State-changing staff commands in Telegram (e.g. clock control). Anyone who controls a linked staff Telegram account could change live tournaments."),
      },
      kiosk: { label: t("Self check-in kiosks"), description: t("Players check in themselves at a kiosk tablet.") },
      dealerInterface: { label: t("Dealer interface"), description: t("Dealer tablets at the tables report busts and call the floor (/dealer).") },
      leagues: { label: t("Leagues"), description: t("Leagues, seasons, points and leaderboards.") },
      publicProfiles: { label: t("Public player profiles"), description: t("Player profiles visible on public pages.") },
      publicSeatList: { label: t("Public seat list"), description: t("Seat assignments shown on TV displays and player live pages.") },
      paidRegistration: { label: t("Prepaid registration"), description: t("Registration is paid in advance, so kiosk check-in creates the buy-in automatically.") },
      prizeTracking: { label: t("Prize tracking"), description: t("Record prize amounts with the results.") },
      memberships: { label: t("Memberships"), description: t("Club membership management.") },
      cashGameWaitlists: { label: t("Cash game waitlists"), description: t("Waiting lists for cash game tables.") },
      timeCharge: { label: t("Time charge"), description: t("Time-based seat charges for cash games.") },
      advancedAnalytics: { label: t("Advanced analytics"), description: t("Retention, funnels and floor operation reports.") },
      cloudSync: { label: t("Cloud sync"), description: t("Send data to the cloud when the Internet is available. Optional: the venue works without it.") },
      remoteAccess: {
        label: t("Remote access"),
        description: t("Staff access from outside the venue network through the cloud. Exposes staff surfaces beyond the local network."),
      },
    };
    const notificationType: Record<NotificationType, string> = {
      REGISTRATION_CONFIRMED: t("Registration confirmed"),
      REGISTRATION_CANCELLED: t("Registration cancelled"),
      TOURNAMENT_REMINDER: t("Tournament reminder"),
      TOURNAMENT_CHANGED: t("Tournament changed"),
      TOURNAMENT_CANCELLED: t("Tournament cancelled"),
      REGISTRATION_OPENING: t("Registration opening"),
      LATE_REGISTRATION_CLOSING: t("Late registration closing"),
      SEAT_ASSIGNED: t("Seat assigned"),
      TABLE_MOVE: t("Table move"),
      RESULTS_FINALIZED: t("Results finalized"),
      LEAGUE_POSITION_CHANGED: t("League position changed"),
      ANNOUNCEMENT: t("Announcement"),
      STAFF_ALERT: t("Staff alert"),
    };
    const notificationStatus: Record<string, string> = {
      PENDING: t("Pending"),
      SENDING: t("Sending"),
      SENT: t("Sent"),
      FAILED: t("Failed"),
      EXPIRED: t("Expired"),
      CANCELLED: t("Cancelled"),
    };
    const channel: Record<string, string> = {
      IN_APP: t("In-app"),
      TELEGRAM: "Telegram",
      EMAIL: t("Email"),
      SMS: "SMS",
      PUSH: t("Push"),
    };
    const telegramStatus: Record<string, string> = {
      DISABLED: t("Disabled"),
      CONNECTING: t("Connecting…"),
      ONLINE: t("Online"),
      OFFLINE: t("Offline"),
      WAITING_FOR_NETWORK: t("Waiting for the Internet"),
      ERROR: t("Error"),
    };
    const edgeStatus: Record<string, string> = {
      ONLINE: t("Online"),
      DEGRADED: t("Degraded"),
      OFFLINE: t("Offline"),
      MAINTENANCE: t("Maintenance"),
    };
    const backupStatus: Record<string, string> = {
      REQUESTED: t("Queued"),
      RUNNING: t("Running"),
      SUCCEEDED: t("Succeeded"),
      FAILED: t("Failed"),
    };
    const role: Record<string, string> = {
      SUPER_ADMIN: t("Super administrator"),
      ORGANIZATION_OWNER: t("Organization owner"),
      MANAGER: t("Manager"),
      TOURNAMENT_DIRECTOR: t("Tournament director"),
      FLOOR_MANAGER: t("Floor manager"),
      REGISTRATION_STAFF: t("Registration staff"),
      CASHIER: t("Cashier"),
      DEALER: t("Dealer"),
      MARKETING_MANAGER: t("Marketing manager"),
      READ_ONLY_ANALYST: t("Read-only analyst"),
      PLAYER: t("Player"),
    };
    const component: Record<string, string> = {
      postgres: t("Database (PostgreSQL)"),
      redis: t("Cache (Redis)"),
      websocket: t("Realtime connections"),
      disk: t("Disk space"),
      backup: t("Backups"),
      wan: t("Internet (WAN)"),
      telegram: "Telegram",
      cloud_sync: t("Cloud sync"),
    };
    const resolution: Record<string, string> = {
      KEEP_LOCAL: t("Keep local"),
      ACCEPT_REMOTE: t("Accept remote"),
      MANUAL: t("Resolved manually"),
    };
    const permissionGroup: Record<string, string> = {
      organization: t("Organization"),
      venue: t("Venue"),
      edge: t("Edge server"),
      device: t("Devices"),
      tournament: t("Tournaments"),
      structure: t("Structures"),
      registration: t("Registration"),
      entry: t("Entries"),
      seat: t("Seating"),
      table: t("Tables"),
      player: t("Players"),
      results: t("Results"),
      league: t("Leagues"),
      staff: t("Staff"),
      settings: t("Settings"),
      telegram: "Telegram",
      announcement: t("Announcements"),
      display: t("Displays"),
      audit: t("Audit log"),
      analytics: t("Analytics"),
      backup: t("Backups"),
      sync: t("Cloud sync"),
      dealer: t("Dealer"),
    };
    const actorKind: Record<string, string> = {
      USER: t("User"),
      SYSTEM: t("System"),
      DEVICE: t("Display or kiosk"),
      ANONYMOUS: t("Anonymous"),
    };
    const channelOrigin: Record<string, string> = {
      WEB: t("Web"),
      TELEGRAM: "Telegram",
      KIOSK: t("Kiosk"),
      DISPLAY: t("Display"),
      SYSTEM: t("System"),
      CLOUD: t("Cloud"),
    };
    return {
      deviceType,
      widget,
      featureFlag,
      notificationType,
      notificationStatus,
      channel,
      telegramStatus,
      edgeStatus,
      backupStatus,
      role,
      component,
      resolution,
      permissionGroup,
      actorKind,
      channelOrigin,
    };
  }, [t]);
}

export type SysLabels = ReturnType<typeof useSysLabels>;

/** Look up a label, falling back to the raw value. */
export const lbl = (map: Record<string, string>, key: string | null | undefined) => (key ? (map[key] ?? key) : "—");
