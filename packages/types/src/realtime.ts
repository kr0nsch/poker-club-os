import { z } from "zod";
import { DEVICE_TYPES } from "./enums.js";

// Local WebSocket protocol (spec §14-15). All traffic stays inside the venue LAN.

export const REALTIME_EVENTS = [
  "tournament.updated",
  "clock.updated",
  "registration.created",
  "registration.updated",
  "entry.created",
  "entry.updated",
  "table.updated",
  "seat.assigned",
  "seat.moved",
  "seat.released",
  "player.eliminated",
  "player.restored",
  "announcement.created",
  "result.updated",
  "edge.status.updated",
  "floor.request.created",
  "floor.request.updated",
  "device.updated",
  "leaderboard.updated",
  "session.revoked",
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

export type TopicKind = "organization" | "venue" | "tournament" | "table" | "display";
export const topic = {
  organization: (id: string) => `organization:${id}`,
  venue: (id: string) => `venue:${id}`,
  tournament: (id: string) => `tournament:${id}`,
  table: (id: string) => `table:${id}`,
  display: (id: string) => `display:${id}`,
} as const;

export function parseTopic(value: string): { kind: TopicKind; id: string } | null {
  const m = /^(organization|venue|tournament|table|display):([0-9a-f-]{36})$/i.exec(value);
  if (!m) return null;
  return { kind: m[1] as TopicKind, id: m[2]!.toLowerCase() };
}

/** Who may receive an event. Public events reach player live pages and TV displays. */
export type Audience = "public" | "staff";

export interface RealtimeEvent<T = unknown> {
  name: RealtimeEventName;
  topics: string[];
  audience: Audience;
  data: T;
  /** Tournament version after the change, when the event belongs to a tournament. */
  tournamentVersion?: number;
  occurredAt: string;
  /** Outbox sequence number (monotonic per edge node) when persisted. */
  seq?: number;
}

// --- client → server ------------------------------------------------------------

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    deviceId: z.uuid().optional(),
    deviceType: z.enum(DEVICE_TYPES).optional(),
    appVersion: z.string().max(40).optional(),
  }),
  z.object({ type: z.literal("subscribe"), topic: z.string().max(80), requestId: z.string().max(40).optional() }),
  z.object({ type: z.literal("unsubscribe"), topic: z.string().max(80) }),
  z.object({ type: z.literal("ping"), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// --- server → client ------------------------------------------------------------

export interface EdgeStatusPayload {
  nodeId: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE" | "MAINTENANCE";
  wanOnline: boolean;
  lastWanSeenAt: string | null;
  telegram: string;
  cloudSync: { enabled: boolean; pending: number; lastSyncAt: string | null };
  serverTime: string;
}

export type ServerMessage =
  | { type: "welcome"; connectionId: string; serverTime: number; principal: "staff" | "player" | "display" | "kiosk" | "anonymous"; edge: EdgeStatusPayload }
  | { type: "subscribed"; topic: string; requestId?: string }
  | { type: "unsubscribed"; topic: string }
  | { type: "event"; event: RealtimeEvent }
  | { type: "pong"; t: number; serverTime: number }
  | { type: "error"; code: string; message: string; topic?: string; requestId?: string };
