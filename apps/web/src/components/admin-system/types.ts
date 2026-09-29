// Response shapes of the venue & system administration endpoints (mirrors
// packages/core services: org, device, edge, sync, backup, display, reports,
// telegram, notifications). Raw SQL numerics (round(...)) arrive as strings.

import type { BackupStatus, DeviceType, DisplayTokenKind, DisplayWidget, EdgeStatusPayload, FeatureFlags, TelegramMode } from "@pcos/types";

export type Numeric = number | string | null;

export interface VenueRow {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  localHostname: string | null;
  localUrl: string | null;
  publicUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    locale: string;
    timezone: string;
    currency: string;
    featureFlags: FeatureFlags;
    notificationTypes: Record<string, boolean>;
    version: number;
  };
}

// --- displays & kiosks -------------------------------------------------------------

export interface DisplayTokenRow {
  id: string;
  organizationId: string;
  venueId: string;
  tournamentId: string | null;
  displayTemplateId: string | null;
  kind: DisplayTokenKind;
  name: string;
  tokenPrefix: string;
  createdBy: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revoked: boolean;
}

/** POST /display-tokens — the plaintext token is returned exactly once. */
export interface DisplayTokenCreated {
  id: string;
  token: string;
  path: string;
  localUrl: string | null;
}

export interface DisplayTheme {
  accent?: string;
  background?: string;
  logoFileId?: string | null;
  sponsorText?: string | null;
}

export interface DisplayTemplateRow {
  id: string;
  organizationId: string;
  name: string;
  widgets: DisplayWidget[];
  theme: DisplayTheme | null;
  createdAt: string;
  updatedAt: string;
}

// --- network, devices, health -------------------------------------------------------------

export interface NetworkInfo {
  nodeId: string;
  localHostname: string | null;
  localUrl: string | null;
  publicUrl: string | null;
  ip: string | null;
  connectedClients: number;
  urls: { staff: string | null; admin: string | null; player: string | null; ipFallback: string | null };
  qr: { staff: string | null; player: string | null; admin: string | null };
}

export interface DeviceRow {
  id: string;
  deviceId: string;
  name: string;
  type: DeviceType;
  trusted: boolean;
  revoked: boolean;
  venueId: string | null;
  assignedTableId: string | null;
  ip: string | null;
  lastSeenAt: string | null;
  connected: boolean;
  connections: number;
  currentUser: string | null;
  appVersion: string | null;
  createdAt: string;
}

export type ComponentState = "OK" | "DEGRADED" | "DOWN" | "DISABLED";

export interface HealthComponent {
  name: string;
  state: ComponentState;
  detail?: string;
  latencyMs?: number;
}

export interface EdgeHealth {
  overall: "OK" | "DEGRADED" | "DOWN";
  components: HealthComponent[];
  edge: EdgeStatusPayload;
}

export interface BackupRun {
  id: string;
  status: BackupStatus;
  trigger: string;
  requestedBy: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  offsiteStatus: string | null;
  error: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SyncCursorRow {
  consumer: string;
  position: number;
  token: string | null;
  updatedAt: string;
  lastError: string | null;
}

export interface SyncStatusView {
  enabled: boolean;
  cloudUrl: string | null;
  counts: { pending: number; failed: number; synced: number; oldest_pending: string | null } | null;
  openConflicts: number;
  cursors: SyncCursorRow[];
}

export interface SyncConflictRow {
  id: string;
  organizationId: string | null;
  entityType: string;
  entityId: string;
  localVersion: number | null;
  remoteVersion: number | null;
  localPayload: unknown;
  remotePayload: unknown;
  reason: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  note: string | null;
}

// --- telegram & notifications ---------------------------------------------------------------

export interface TelegramIntegrationView {
  enabled: boolean;
  mode: TelegramMode;
  botUsername: string | null;
  status: string;
  lastUpdateAt: string | null;
  lastError: string | null;
  staffAlertsChatId: string | null;
  tokenConfigured: boolean;
  tokenSource: "DB" | "ENV" | null;
  staffMutationCommandsEnabled: boolean;
}

export interface NotificationRow {
  id: string;
  organizationId: string;
  channel: string;
  type: string;
  playerId: string | null;
  userId: string | null;
  recipient: string | null;
  payload: Record<string, unknown> | null;
  dedupeKey: string | null;
  status: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  expiresAt: string | null;
  sentAt: string | null;
  readAt: string | null;
}

export interface NotificationQueueView {
  counts: { pending: number; sent: number; failed: number; expired: number } | null;
  items: NotificationRow[];
}

export interface TelegramDeliveryRow {
  id: string;
  organizationId: string;
  notificationId: string | null;
  chatId: number;
  messageId: number | null;
  status: string;
  error: string | null;
  httpStatus: number | null;
  createdAt: string;
}

// --- staff & roles ------------------------------------------------------------------------------

export interface StaffRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  lastLoginAt: string | null;
  memberId: string;
  roles: string[];
  venueIds: string[] | null;
  memberStatus: string;
}

export interface RoleView {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

export interface RolesResponse {
  roles: RoleView[];
  permissions: string[];
}

// --- audit & analytics ------------------------------------------------------------------------------

export interface AuditRow {
  id: string;
  organizationId: string | null;
  venueId: string | null;
  edgeNodeId: string | null;
  actorId: string | null;
  actorKind: string;
  deviceId: string | null;
  tournamentId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  actorName: string | null;
}

export interface AnalyticsView {
  range: { from: string; to: string };
  checkin: { median_minutes_before_start: Numeric; p90_minutes_before_start: Numeric; samples: number } | null;
  registration: {
    registrations: number;
    played: number;
    conversion_rate: Numeric;
    via_telegram: number;
    via_web: number;
    via_kiosk: number;
    via_staff: number;
  } | null;
  entries: { entries: number; late_registration_rate: Numeric; reentry_rate: Numeric } | null;
  floor: { balance_actions: number; table_breaks: number; undo_actions: number } | null;
  breakTiming: { id: string; name: string; avg_minutes_after_start: Numeric; breaks: number }[];
  finalTable: { id: string; name: string; minutes_to_final_table: Numeric }[];
  venues: { id: string; name: string; tournaments: number; avg_entries: Numeric }[];
  weekdays: { weekday: number; tournaments: number; avg_entries: Numeric }[];
  cohorts: { cohort: string; players: number; month_1: number; month_2: number; month_3: number }[];
  telegram: {
    sent: number;
    expired: number;
    failed: number;
    registrations_via_telegram: number;
    registrations_after_notification: number;
  } | null;
}
