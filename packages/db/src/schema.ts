// Database schema (PostgreSQL). Column names are snake_case in the database
// (drizzle `casing: "snake_case"`), camelCase in TypeScript.
//
// Conventions
//  * Every tenant-owned row carries organization_id (spec §36).
//  * Enumerations are text columns with CHECK constraints (migration-friendly).
//  * Mutable aggregates carry `version` for optimistic concurrency (spec §64).
//  * History tables (audit_logs, seat_movements, operational_actions,
//    entry_transactions) are append-only; corrections are new rows.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid().primaryKey().defaultRandom();
const orgRef = () =>
  uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const ts = () => timestamp({ withTimezone: true });
const inList = (col: string, values: readonly string[]) => sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(", ")})`);

// ---------------------------------------------------------------------------
// Tenancy, edge, identity
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  locale: text().notNull().default("en"),
  timezone: text().notNull().default("Europe/Berlin"),
  currency: text().notNull().default("EUR"),
  featureFlags: jsonb().$type<Record<string, boolean>>().notNull().default({}),
  notificationTypes: jsonb().$type<Record<string, boolean>>().notNull().default({}),
  version: integer().notNull().default(0),
  updatedAt: updatedAt(),
});

export const venues = pgTable(
  "venues",
  {
    id: id(),
    organizationId: orgRef(),
    name: text().notNull(),
    slug: text().notNull(),
    timezone: text().notNull().default("Europe/Berlin"),
    address: text(),
    localHostname: text(),
    localUrl: text(),
    publicUrl: text(),
    version: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("venues_org_slug_uq").on(t.organizationId, t.slug)],
);

export const venueEdgeNodes = pgTable(
  "venue_edge_nodes",
  {
    id: id(),
    organizationId: orgRef(),
    venueId: uuid()
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    nodeId: text().notNull().unique(),
    name: text().notNull(),
    status: text().notNull().default("ONLINE"),
    version: integer().notNull().default(0),
    softwareVersion: text(),
    localAddress: text(),
    lastSeenAt: ts(),
    lastWanSeenAt: ts(),
    lastCloudSyncAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [check("venue_edge_nodes_status_ck", inList("status", ["ONLINE", "DEGRADED", "OFFLINE", "MAINTENANCE"]))],
);

export const users = pgTable("users", {
  id: id(),
  email: text().notNull().unique(),
  passwordHash: text(),
  displayName: text().notNull(),
  status: text().notNull().default("ACTIVE"),
  isSuperAdmin: boolean().notNull().default(false),
  failedLoginCount: integer().notNull().default(0),
  lockedUntil: ts(),
  lastLoginAt: ts(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid(),
    kind: text().notNull().default("STAFF"),
    csrfToken: text().notNull(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
    lastSeenAt: ts(),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_device_idx").on(t.deviceId)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    /** null = system role available to every organization */
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    isSystem: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("roles_org_key_uq").on(sql`coalesce(${t.organizationId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: id(),
    organizationId: orgRef(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roles: text().array().notNull(),
    /** null = access to all venues */
    venueIds: uuid().array(),
    status: text().notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("org_members_org_user_uq").on(t.organizationId, t.userId)],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    organizationId: orgRef(),
    venueId: uuid().references(() => venues.id, { onDelete: "set null" }),
    /** client-generated stable identifier (localStorage) */
    deviceId: uuid().notNull(),
    name: text().notNull(),
    type: text().notNull().default("OTHER"),
    trusted: boolean().notNull().default(false),
    revokedAt: ts(),
    assignedTableId: uuid(),
    lastSeenAt: ts(),
    lastIp: text(),
    appVersion: text(),
    userAgent: text(),
    currentUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("devices_org_device_uq").on(t.organizationId, t.deviceId),
    check(
      "devices_type_ck",
      inList("type", ["ADMIN_PC", "TD_TABLET", "FLOOR_PHONE", "DEALER_TABLET", "CASHIER", "REGISTRATION_DESK", "DISPLAY", "KIOSK", "OTHER"]),
    ),
  ],
);

export const systemKv = pgTable("system_kv", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Player CRM
// ---------------------------------------------------------------------------

export const players = pgTable(
  "players",
  {
    id: id(),
    organizationId: orgRef(),
    externalPublicId: text().notNull(),
    memberNumber: text(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    firstName: text().notNull(),
    lastName: text().notNull(),
    displayName: text().notNull(),
    nickname: text(),
    email: text(),
    phone: text(),
    avatarFileId: uuid(),
    language: text(),
    country: text(),
    dateOfBirth: date(),
    status: text().notNull().default("ACTIVE"),
    source: text().notNull().default("STAFF"),
    marketingConsent: boolean().notNull().default(false),
    publicProfileEnabled: boolean().notNull().default(false),
    kioskPinHash: text(),
    /** lowercase concatenation of names/nickname/email/phone/member number for quick search */
    searchText: text().notNull().default(""),
    version: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("players_public_id_uq").on(t.externalPublicId),
    uniqueIndex("players_org_member_uq").on(t.organizationId, t.memberNumber).where(sql`${t.memberNumber} is not null`),
    uniqueIndex("players_org_email_uq").on(t.organizationId, t.email).where(sql`${t.email} is not null`),
    uniqueIndex("players_org_user_uq").on(t.organizationId, t.userId).where(sql`${t.userId} is not null`),
    index("players_org_idx").on(t.organizationId),
    index("players_search_idx").on(t.organizationId, t.searchText),
    check("players_status_ck", inList("status", ["ACTIVE", "INACTIVE", "BANNED", "MERGED"])),
  ],
);

export const playerTags = pgTable(
  "player_tags",
  {
    id: id(),
    organizationId: orgRef(),
    name: text().notNull(),
    color: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("player_tags_org_name_uq").on(t.organizationId, t.name)],
);

export const playerTagLinks = pgTable(
  "player_tag_links",
  {
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    tagId: uuid()
      .notNull()
      .references(() => playerTags.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.tagId] })],
);

export const playerNotes = pgTable(
  "player_notes",
  {
    id: id(),
    organizationId: orgRef(),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    body: text().notNull(),
    visibility: text().notNull().default("STAFF"),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("player_notes_player_idx").on(t.playerId)],
);

export const playerConsents = pgTable(
  "player_consents",
  {
    id: id(),
    organizationId: orgRef(),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    type: text().notNull(),
    granted: boolean().notNull(),
    source: text().notNull(),
    recordedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("player_consents_player_idx").on(t.playerId, t.type)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    organizationId: orgRef(),
    playerId: uuid().references(() => players.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    channel: text().notNull(),
    type: text().notNull(),
    enabled: boolean().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("notification_prefs_player_uq").on(t.playerId, t.channel, t.type).where(sql`${t.playerId} is not null`),
    uniqueIndex("notification_prefs_user_uq").on(t.userId, t.channel, t.type).where(sql`${t.userId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Tournament configuration
// ---------------------------------------------------------------------------

export const houseRulesProfiles = pgTable("house_rules_profiles", {
  id: id(),
  organizationId: orgRef(),
  name: text().notNull(),
  preset: text().notNull().default("CUSTOM"),
  config: jsonb().notNull(),
  isDefault: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tournamentStructures = pgTable(
  "tournament_structures",
  {
    id: id(),
    organizationId: orgRef(),
    name: text().notNull(),
    description: text(),
    /** set when this is a tournament's private copy (snapshot) of a template structure */
    ownerTournamentId: uuid(),
    version: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("structures_org_idx").on(t.organizationId)],
);

export const structureLevels = pgTable(
  "structure_levels",
  {
    id: id(),
    structureId: uuid()
      .notNull()
      .references(() => tournamentStructures.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    type: text().notNull(),
    smallBlind: bigint({ mode: "number" }).notNull().default(0),
    bigBlind: bigint({ mode: "number" }).notNull().default(0),
    ante: bigint({ mode: "number" }).notNull().default(0),
    anteType: text().notNull().default("NONE"),
    durationSeconds: integer().notNull(),
    label: text(),
    note: text(),
  },
  (t) => [
    uniqueIndex("structure_levels_pos_uq").on(t.structureId, t.position),
    check("structure_levels_type_ck", inList("type", ["PLAY", "BREAK"])),
    check("structure_levels_ante_ck", inList("ante_type", ["NONE", "STANDARD", "BIG_BLIND"])),
    check("structure_levels_duration_ck", sql`duration_seconds > 0`),
  ],
);

export const tournamentTemplates = pgTable("tournament_templates", {
  id: id(),
  organizationId: orgRef(),
  name: text().notNull(),
  config: jsonb().notNull(),
  structureId: uuid()
    .notNull()
    .references(() => tournamentStructures.id),
  houseRulesProfileId: uuid().references(() => houseRulesProfiles.id, { onDelete: "set null" }),
  displayTemplateId: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const leagues = pgTable("leagues", {
  id: id(),
  organizationId: orgRef(),
  name: text().notNull(),
  description: text(),
  scoreRuleId: uuid().notNull(),
  bestResultsCount: integer(),
  status: text().notNull().default("ACTIVE"),
  version: integer().notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const seasons = pgTable("seasons", {
  id: id(),
  organizationId: orgRef(),
  leagueId: uuid()
    .notNull()
    .references(() => leagues.id, { onDelete: "cascade" }),
  name: text().notNull(),
  startsOn: date().notNull(),
  endsOn: date().notNull(),
  createdAt: createdAt(),
});

export const series = pgTable("series", {
  id: id(),
  organizationId: orgRef(),
  seasonId: uuid().references(() => seasons.id, { onDelete: "set null" }),
  name: text().notNull(),
  startsOn: date(),
  endsOn: date(),
  createdAt: createdAt(),
});

export const scoreRules = pgTable("score_rules", {
  id: id(),
  organizationId: orgRef(),
  name: text().notNull(),
  kind: text().notNull(),
  config: jsonb().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tournaments = pgTable(
  "tournaments",
  {
    id: id(),
    organizationId: orgRef(),
    venueId: uuid()
      .notNull()
      .references(() => venues.id),
    seriesId: uuid().references(() => series.id, { onDelete: "set null" }),
    seasonId: uuid().references(() => seasons.id, { onDelete: "set null" }),
    templateId: uuid().references(() => tournamentTemplates.id, { onDelete: "set null" }),
    structureId: uuid()
      .notNull()
      .references(() => tournamentStructures.id),
    houseRulesProfileId: uuid().references(() => houseRulesProfiles.id, { onDelete: "set null" }),
    houseRules: jsonb().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    gameType: text().notNull().default("NLHE"),
    format: text().notNull().default("FREEZEOUT"),
    status: text().notNull().default("DRAFT"),
    pausedFromStatus: text(),
    startAt: timestamp({ withTimezone: true }).notNull(),
    registrationOpenAt: ts(),
    registrationCloseAt: ts(),
    maxPlayers: integer(),
    expectedPlayers: integer(),
    startingStack: bigint({ mode: "number" }).notNull(),
    tableSize: integer().notNull().default(9),
    buyIn: jsonb().$type<{ amount: number; fee: number; currency: string } | null>(),
    lateRegistrationPolicy: jsonb().notNull(),
    reentryPolicy: jsonb().notNull(),
    rebuyPolicy: jsonb().notNull(),
    addonPolicy: jsonb().notNull(),
    bountyPolicy: jsonb().notNull(),
    lateRegistrationClosed: boolean().notNull().default(false),
    published: boolean().notNull().default(false),
    publicVisibility: text().notNull().default("PUBLIC"),
    lastEliminationSeq: integer().notNull().default(0),
    version: integer().notNull().default(0),
    startedAt: ts(),
    finishedAt: ts(),
    finalizedAt: ts(),
    cancelledAt: ts(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tournaments_org_slug_uq").on(t.organizationId, t.slug),
    index("tournaments_venue_start_idx").on(t.venueId, t.startAt),
    index("tournaments_status_idx").on(t.organizationId, t.status),
    check(
      "tournaments_status_ck",
      inList("status", [
        "DRAFT",
        "SCHEDULED",
        "REGISTRATION_OPEN",
        "SEATING",
        "RUNNING",
        "BREAK",
        "PAUSED",
        "HAND_FOR_HAND",
        "FINISHED",
        "FINALIZED",
        "CANCELLED",
      ]),
    ),
    check("tournaments_visibility_ck", inList("public_visibility", ["PUBLIC", "UNLISTED", "PRIVATE"])),
  ],
);

// ---------------------------------------------------------------------------
// Live tournament operation
// ---------------------------------------------------------------------------

export const tournamentRegistrations = pgTable(
  "tournament_registrations",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    playerId: uuid()
      .notNull()
      .references(() => players.id),
    status: text().notNull(),
    source: text().notNull(),
    /** short random code for QR self check-in */
    checkInCode: text().notNull(),
    waitlistPosition: integer(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    registeredAt: createdAt(),
    checkedInAt: ts(),
    cancelledAt: ts(),
    version: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live registration per player per tournament.
    uniqueIndex("registrations_active_uq")
      .on(t.tournamentId, t.playerId)
      .where(sql`${t.status} not in ('CANCELLED', 'NO_SHOW')`),
    uniqueIndex("registrations_checkin_code_uq").on(t.checkInCode),
    index("registrations_tournament_idx").on(t.tournamentId, t.status),
    index("registrations_player_idx").on(t.playerId),
    check(
      "registrations_status_ck",
      inList("status", ["RESERVED", "REGISTERED", "CHECKED_IN", "WAITLISTED", "PLAYING", "ELIMINATED", "CANCELLED", "NO_SHOW"]),
    ),
  ],
);

export const tournamentEntries = pgTable(
  "tournament_entries",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    registrationId: uuid()
      .notNull()
      .references(() => tournamentRegistrations.id),
    playerId: uuid()
      .notNull()
      .references(() => players.id),
    entryNumber: integer().notNull(),
    type: text().notNull(),
    status: text().notNull().default("ACTIVE"),
    eliminatedAt: ts(),
    eliminationSeq: integer(),
    eliminatedByEntryId: uuid(),
    finishPosition: integer(),
    voidedAt: ts(),
    version: integer().notNull().default(0),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("entries_player_number_uq").on(t.tournamentId, t.playerId, t.entryNumber),
    // A player can hold at most one active entry.
    uniqueIndex("entries_one_active_uq")
      .on(t.tournamentId, t.playerId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index("entries_tournament_idx").on(t.tournamentId, t.status),
    check("entries_type_ck", inList("type", ["INITIAL", "REENTRY"])),
    check("entries_status_ck", inList("status", ["ACTIVE", "ELIMINATED", "VOIDED"])),
  ],
);

export const entryTransactions = pgTable(
  "entry_transactions",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    entryId: uuid()
      .notNull()
      .references(() => tournamentEntries.id),
    type: text().notNull(),
    chips: bigint({ mode: "number" }).notNull().default(0),
    amount: bigint({ mode: "number" }).notNull().default(0),
    voidsTransactionId: uuid(),
    voided: boolean().notNull().default(false),
    reason: text(),
    actionId: uuid(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("entry_tx_entry_idx").on(t.entryId),
    index("entry_tx_tournament_idx").on(t.tournamentId),
    check("entry_tx_type_ck", inList("type", ["BUY_IN", "REBUY", "ADD_ON", "CHIP_ADJUSTMENT", "BOUNTY_WON", "VOID"])),
  ],
);

export const tournamentTables = pgTable(
  "tournament_tables",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    tableNumber: integer().notNull(),
    capacity: integer().notNull(),
    status: text().notNull().default("OPEN"),
    dealerButtonSeat: integer(),
    createdAt: createdAt(),
    closedAt: ts(),
  },
  (t) => [
    uniqueIndex("tables_number_uq").on(t.tournamentId, t.tableNumber),
    check("tables_status_ck", inList("status", ["OPEN", "ACTIVE", "BREAKING", "CLOSED"])),
    check("tables_capacity_ck", sql`capacity between 2 and 11`),
  ],
);

export const tournamentSeatLocks = pgTable(
  "tournament_seat_locks",
  {
    id: id(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    tableId: uuid()
      .notNull()
      .references(() => tournamentTables.id, { onDelete: "cascade" }),
    seatNumber: integer().notNull(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("seat_locks_uq").on(t.tableId, t.seatNumber)],
);

export const tournamentSeatAssignments = pgTable(
  "tournament_seat_assignments",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    tableId: uuid()
      .notNull()
      .references(() => tournamentTables.id),
    seatNumber: integer().notNull(),
    entryId: uuid()
      .notNull()
      .references(() => tournamentEntries.id),
    playerId: uuid()
      .notNull()
      .references(() => players.id),
    status: text().notNull().default("ACTIVE"),
    present: boolean().notNull().default(false),
    assignedAt: createdAt(),
    releasedAt: ts(),
  },
  (t) => [
    // Spec §54: no duplicate active assignment — per seat and per entry.
    uniqueIndex("seat_active_seat_uq")
      .on(t.tableId, t.seatNumber)
      .where(sql`${t.status} = 'ACTIVE'`),
    uniqueIndex("seat_active_entry_uq")
      .on(t.entryId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index("seat_tournament_idx").on(t.tournamentId, t.status),
    check("seat_status_ck", inList("status", ["ACTIVE", "RELEASED"])),
  ],
);

export const seatMovements = pgTable(
  "seat_movements",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    entryId: uuid()
      .notNull()
      .references(() => tournamentEntries.id),
    playerId: uuid().notNull(),
    fromTableId: uuid(),
    fromTableNumber: integer(),
    fromSeat: integer(),
    toTableId: uuid(),
    toTableNumber: integer(),
    toSeat: integer(),
    reason: text().notNull(),
    actionId: uuid(),
    confirmedAt: ts(),
    performedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("seat_movements_tournament_idx").on(t.tournamentId, t.createdAt)],
);

export const tournamentClockStates = pgTable("tournament_clock_states", {
  tournamentId: uuid()
    .primaryKey()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  clockStatus: text().notNull().default("NOT_STARTED"),
  currentLevelId: uuid(),
  currentLevelIndex: integer().notNull().default(0),
  startedAt: ts(),
  pausedAt: ts(),
  remainingAtPauseMs: bigint({ mode: "number" }),
  version: integer().notNull().default(0),
  updatedAt: updatedAt(),
});

export const operationalActions = pgTable(
  "operational_actions",
  {
    id: id(),
    organizationId: orgRef(),
    venueId: uuid(),
    tournamentId: uuid().references(() => tournaments.id, { onDelete: "cascade" }),
    type: text().notNull(),
    /** client-provided idempotency key (spec §65) */
    clientOperationId: uuid().notNull(),
    requestHash: text().notNull(),
    payload: jsonb().notNull(),
    result: jsonb(),
    /** entity keys touched by the action, for REBASE conflict detection */
    affectedKeys: text().array().notNull(),
    summary: text().notNull(),
    resultVersion: integer().notNull(),
    compensatesActionId: uuid(),
    compensatedByActionId: uuid(),
    actorId: uuid(),
    deviceId: uuid(),
    edgeNodeId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("op_actions_idempotency_uq").on(t.organizationId, t.clientOperationId),
    index("op_actions_tournament_idx").on(t.tournamentId, t.resultVersion),
    index("op_actions_keys_idx").using("gin", t.affectedKeys),
  ],
);

export const floorRequests = pgTable(
  "floor_requests",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    tableId: uuid()
      .notNull()
      .references(() => tournamentTables.id),
    kind: text().notNull(),
    seatNumber: integer(),
    message: text(),
    status: text().notNull().default("OPEN"),
    createdBy: uuid(),
    deviceId: uuid(),
    createdAt: createdAt(),
    resolvedAt: ts(),
    resolvedBy: uuid(),
  },
  (t) => [
    index("floor_requests_tournament_idx").on(t.tournamentId, t.status),
    check("floor_requests_kind_ck", inList("kind", ["CALL_FLOOR", "BUST_REPORT"])),
    check("floor_requests_status_ck", inList("status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"])),
  ],
);

export const tournamentResults = pgTable(
  "tournament_results",
  {
    id: id(),
    organizationId: orgRef(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    playerId: uuid()
      .notNull()
      .references(() => players.id),
    position: integer().notNull(),
    entries: integer().notNull().default(1),
    bounties: integer().notNull().default(0),
    points: jsonb().$type<number | null>(),
    prizeAmount: bigint({ mode: "number" }),
    status: text().notNull().default("PROVISIONAL"),
    revision: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("results_player_uq").on(t.tournamentId, t.playerId),
    index("results_tournament_idx").on(t.tournamentId, t.position),
    check("results_status_ck", inList("status", ["PROVISIONAL", "FINALIZED"])),
  ],
);

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: id(),
    organizationId: orgRef(),
    seasonId: uuid()
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    rows: jsonb().notNull(),
    computedAt: createdAt(),
    triggeredByTournamentId: uuid(),
  },
  (t) => [index("leaderboard_season_idx").on(t.seasonId, t.computedAt)],
);

// ---------------------------------------------------------------------------
// Communication, displays
// ---------------------------------------------------------------------------

export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    organizationId: orgRef(),
    venueId: uuid(),
    tournamentId: uuid().references(() => tournaments.id, { onDelete: "cascade" }),
    body: text().notNull(),
    severity: text().notNull().default("INFO"),
    channels: text().array().notNull(),
    createdBy: uuid(),
    createdAt: createdAt(),
    displayUntil: ts(),
  },
  (t) => [index("announcements_tournament_idx").on(t.tournamentId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: orgRef(),
    channel: text().notNull(),
    type: text().notNull(),
    playerId: uuid(),
    userId: uuid(),
    /** transport address, e.g. telegram chat id; resolved at enqueue time */
    recipient: text(),
    payload: jsonb().notNull(),
    dedupeKey: text(),
    status: text().notNull().default("PENDING"),
    attemptCount: integer().notNull().default(0),
    nextAttemptAt: ts(),
    lastError: text(),
    createdAt: createdAt(),
    expiresAt: ts(),
    sentAt: ts(),
    readAt: ts(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.organizationId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("notifications_due_idx").on(t.status, t.nextAttemptAt),
    index("notifications_player_idx").on(t.playerId, t.createdAt),
    check("notifications_status_ck", inList("status", ["PENDING", "SENDING", "SENT", "FAILED", "EXPIRED", "CANCELLED"])),
  ],
);

export const displayTemplates = pgTable("display_templates", {
  id: id(),
  organizationId: orgRef(),
  name: text().notNull(),
  widgets: text().array().notNull(),
  theme: jsonb().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const displayTokens = pgTable(
  "display_tokens",
  {
    id: id(),
    organizationId: orgRef(),
    venueId: uuid()
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    tournamentId: uuid().references(() => tournaments.id, { onDelete: "set null" }),
    displayTemplateId: uuid().references(() => displayTemplates.id, { onDelete: "set null" }),
    kind: text().notNull().default("DISPLAY"),
    name: text().notNull(),
    tokenHash: text().notNull().unique(),
    /** first characters of the token, to help staff recognise it */
    tokenPrefix: text().notNull(),
    createdBy: uuid(),
    createdAt: createdAt(),
    lastSeenAt: ts(),
    revokedAt: ts(),
  },
  (t) => [check("display_tokens_kind_ck", inList("kind", ["DISPLAY", "KIOSK"]))],
);

export const oneTimeCodes = pgTable(
  "one_time_codes",
  {
    id: id(),
    organizationId: orgRef(),
    playerId: uuid()
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    purpose: text().notNull(),
    codeHash: text().notNull(),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index("otc_lookup_idx").on(t.organizationId, t.purpose, t.codeHash)],
);

// ---------------------------------------------------------------------------
// Telegram (spec §19-33)
// ---------------------------------------------------------------------------

export const telegramIntegrations = pgTable("telegram_integrations", {
  organizationId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  botUsername: text(),
  /** AES-256-GCM encrypted with the edge secret key; never returned by the API */
  encryptedBotToken: text(),
  mode: text().notNull().default("EDGE_LONG_POLLING"),
  enabled: boolean().notNull().default(false),
  status: text().notNull().default("DISABLED"),
  lastUpdateId: bigint({ mode: "number" }),
  lastUpdateAt: ts(),
  lastError: text(),
  staffAlertsChatId: text(),
  updatedAt: updatedAt(),
});

export const telegramAccountLinks = pgTable(
  "telegram_account_links",
  {
    id: id(),
    organizationId: orgRef(),
    playerId: uuid().references(() => players.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    telegramUserId: bigint({ mode: "number" }).notNull(),
    telegramChatId: bigint({ mode: "number" }).notNull(),
    telegramUsername: text(),
    status: text().notNull().default("ACTIVE"),
    linkedAt: createdAt(),
    verifiedAt: ts(),
    revokedAt: ts(),
  },
  (t) => [
    uniqueIndex("tg_links_org_tguser_active_uq")
      .on(t.organizationId, t.telegramUserId)
      .where(sql`${t.status} = 'ACTIVE'`),
    uniqueIndex("tg_links_player_active_uq")
      .on(t.playerId)
      .where(sql`${t.status} = 'ACTIVE' and ${t.playerId} is not null`),
    uniqueIndex("tg_links_user_active_uq")
      .on(t.organizationId, t.userId)
      .where(sql`${t.status} = 'ACTIVE' and ${t.userId} is not null`),
  ],
);

export const telegramSubscriptions = pgTable(
  "telegram_subscriptions",
  {
    id: id(),
    organizationId: orgRef(),
    telegramChatId: bigint({ mode: "number" }).notNull(),
    playerId: uuid(),
    topic: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tg_subscriptions_uq").on(t.organizationId, t.telegramChatId, t.topic)],
);

export const telegramDeliveries = pgTable(
  "telegram_deliveries",
  {
    id: id(),
    organizationId: orgRef(),
    notificationId: uuid().references(() => notifications.id, { onDelete: "cascade" }),
    chatId: bigint({ mode: "number" }).notNull(),
    messageId: bigint({ mode: "number" }),
    status: text().notNull(),
    error: text(),
    httpStatus: integer(),
    createdAt: createdAt(),
  },
  (t) => [index("tg_deliveries_notification_idx").on(t.notificationId)],
);

export const telegramUpdateReceipts = pgTable(
  "telegram_update_receipts",
  {
    organizationId: orgRef(),
    updateId: bigint({ mode: "number" }).notNull(),
    kind: text().notNull(),
    status: text().notNull().default("RECEIVED"),
    receivedAt: createdAt(),
    processedAt: ts(),
    error: text(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.updateId] })],
);

export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    id: id(),
    organizationId: orgRef(),
    /** DEEP_LINK: created by a logged-in player; CODE: requested from the bot, entered on the web */
    kind: text().notNull(),
    playerId: uuid().references(() => players.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    telegramUserId: bigint({ mode: "number" }),
    telegramChatId: bigint({ mode: "number" }),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [check("tg_link_tokens_kind_ck", inList("kind", ["DEEP_LINK", "CODE"]))],
);

// ---------------------------------------------------------------------------
// Audit, files, import/export
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid(),
    venueId: uuid(),
    edgeNodeId: text(),
    actorId: uuid(),
    actorKind: text().notNull().default("USER"),
    deviceId: uuid(),
    tournamentId: uuid(),
    entityType: text().notNull(),
    entityId: text(),
    action: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    metadata: jsonb(),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_org_time_idx").on(t.organizationId, t.createdAt),
    index("audit_tournament_idx").on(t.tournamentId, t.createdAt),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const fileAssets = pgTable("file_assets", {
  id: id(),
  organizationId: orgRef(),
  kind: text().notNull(),
  filename: text().notNull(),
  mimeType: text().notNull(),
  sizeBytes: integer().notNull(),
  sha256: text().notNull(),
  storageKey: text().notNull(),
  createdBy: uuid(),
  createdAt: createdAt(),
});

export const importJobs = pgTable("import_jobs", {
  id: id(),
  organizationId: orgRef(),
  kind: text().notNull(),
  status: text().notNull(),
  filename: text().notNull(),
  fileId: uuid(),
  headers: text().array().notNull(),
  mapping: jsonb(),
  duplicateStrategy: text().notNull().default("SKIP"),
  preview: jsonb(),
  report: jsonb(),
  createdBy: uuid(),
  createdAt: createdAt(),
  appliedAt: ts(),
});

export const exportJobs = pgTable("export_jobs", {
  id: id(),
  organizationId: orgRef(),
  kind: text().notNull(),
  status: text().notNull(),
  params: jsonb(),
  fileId: uuid(),
  rowCount: integer(),
  createdBy: uuid(),
  createdAt: createdAt(),
  completedAt: ts(),
});

// ---------------------------------------------------------------------------
// Durable outbox & sync (spec §8)
// ---------------------------------------------------------------------------

export const outboxEvents = pgTable(
  "outbox_events",
  {
    seq: bigserial({ mode: "number" }).primaryKey(),
    eventId: uuid().notNull().unique().defaultRandom(),
    organizationId: uuid(),
    venueId: uuid(),
    edgeNodeId: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    eventType: text().notNull(),
    entityVersion: integer(),
    payload: jsonb().notNull(),
    /** realtime delivery metadata (topics, audience) */
    realtime: jsonb(),
    /** whether the event is replicated to the cloud control plane */
    syncable: boolean().notNull().default(true),
    syncStatus: text().notNull().default("PENDING"),
    syncAttempts: integer().notNull().default(0),
    syncedAt: ts(),
    lastError: text(),
    occurredAt: createdAt(),
  },
  (t) => [
    index("outbox_sync_idx").on(t.syncStatus, t.seq),
    index("outbox_aggregate_idx").on(t.aggregateType, t.aggregateId, t.seq),
    check("outbox_sync_status_ck", inList("sync_status", ["PENDING", "SYNCED", "FAILED", "SKIPPED"])),
  ],
);

export const syncCursors = pgTable("sync_cursors", {
  /** consumer name, e.g. "cloud-push", "notification-fanout", "cloud-pull" */
  consumer: text().primaryKey(),
  position: bigint({ mode: "number" }).notNull().default(0),
  /** opaque cursor for pull-style consumers */
  token: text(),
  updatedAt: updatedAt(),
  lastError: text(),
});

export const syncConflicts = pgTable(
  "sync_conflicts",
  {
    id: id(),
    organizationId: uuid(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    localVersion: integer(),
    remoteVersion: integer(),
    localPayload: jsonb(),
    remotePayload: jsonb(),
    reason: text().notNull(),
    detectedAt: createdAt(),
    resolvedAt: ts(),
    resolution: text(),
    resolvedBy: uuid(),
    note: text(),
  },
  (t) => [index("sync_conflicts_open_idx").on(t.resolvedAt, t.detectedAt)],
);

export const backupRuns = pgTable("backup_runs", {
  id: id(),
  status: text().notNull(),
  trigger: text().notNull().default("SCHEDULE"),
  requestedBy: uuid(),
  fileName: text(),
  sizeBytes: bigint({ mode: "number" }),
  offsiteStatus: text(),
  error: text(),
  requestedAt: createdAt(),
  startedAt: ts(),
  finishedAt: ts(),
});
