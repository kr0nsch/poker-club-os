// Read models returned by the API and consumed by every surface.
import type {
  AnteType,
  ClockStatus,
  EntryStatus,
  EntryTransactionType,
  EntryType,
  FeatureFlags,
  GameType,
  LevelType,
  PublicVisibility,
  RegistrationSource,
  RegistrationStatus,
  ResultStatus,
  Severity,
  TableStatus,
  TournamentFormat,
  TournamentStatus,
} from "./enums.js";
import type { Permission } from "./permissions.js";
import type {
  AddonPolicy,
  BountyPolicy,
  HouseRulesConfig,
  LateRegistrationPolicy,
  RebuyPolicy,
  ReentryPolicy,
} from "./schemas/tournaments.js";
import type { Money } from "./schemas/common.js";

export interface LevelView {
  id: string;
  index: number;
  type: LevelType;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  anteType: AnteType;
  durationSeconds: number;
  label: string | null;
  note: string | null;
}

/** Persisted authoritative clock (spec §16, §51). Clients derive the countdown. */
export interface ClockView {
  status: ClockStatus;
  levelIndex: number;
  levelId: string | null;
  /** Wall-clock instant at which the current level (virtually) started running. */
  startedAt: string | null;
  pausedAt: string | null;
  remainingAtPauseMs: number | null;
  version: number;
}

export interface TournamentStats {
  registrations: number;
  checkedIn: number;
  waitlisted: number;
  entries: number;
  uniquePlayers: number;
  reentries: number;
  rebuys: number;
  addons: number;
  remaining: number;
  totalChips: number;
  averageStack: number | null;
  prizePool: number | null;
}

export interface TournamentSummaryView {
  id: string;
  organizationId: string;
  venueId: string;
  name: string;
  slug: string;
  status: TournamentStatus;
  format: TournamentFormat;
  gameType: GameType;
  startAt: string;
  published: boolean;
  publicVisibility: PublicVisibility;
  maxPlayers: number | null;
  registrationCount: number;
  buyIn: Money | null;
  version: number;
}

export interface TournamentDetailView extends TournamentSummaryView {
  description: string | null;
  startingStack: number;
  tableSize: number;
  expectedPlayers: number | null;
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
  lateRegistrationPolicy: LateRegistrationPolicy;
  reentryPolicy: ReentryPolicy;
  rebuyPolicy: RebuyPolicy;
  addonPolicy: AddonPolicy;
  bountyPolicy: BountyPolicy;
  lateRegistrationClosed: boolean;
  structureId: string;
  templateId: string | null;
  seriesId: string | null;
  seasonId: string | null;
  houseRules: HouseRulesConfig;
  houseRulesProfileId: string | null;
  pausedFromStatus: TournamentStatus | null;
  startedAt: string | null;
  finishedAt: string | null;
  finalizedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeatView {
  seatNumber: number;
  assignmentId: string | null;
  entryId: string | null;
  playerId: string | null;
  playerName: string | null;
  present: boolean;
  locked: boolean;
  lockReason: string | null;
}

export interface TableView {
  id: string;
  tableNumber: number;
  capacity: number;
  status: TableStatus;
  dealerButtonSeat: number | null;
  occupied: number;
  seats: SeatView[];
}

export interface RegistrationView {
  id: string;
  playerId: string;
  playerName: string;
  nickname: string | null;
  memberNumber: string | null;
  status: RegistrationStatus;
  source: RegistrationSource;
  registeredAt: string;
  checkedInAt: string | null;
  cancelledAt: string | null;
  checkInCode: string | null;
  waitlistPosition: number | null;
}

export interface EntryView {
  id: string;
  registrationId: string;
  playerId: string;
  playerName: string;
  entryNumber: number;
  type: EntryType;
  status: EntryStatus;
  chips: number;
  rebuys: number;
  addons: number;
  tableId: string | null;
  tableNumber: number | null;
  seatNumber: number | null;
  eliminatedAt: string | null;
  finishPosition: number | null;
  eliminatedByEntryId: string | null;
  version: number;
  createdAt: string;
}

export interface EntryTransactionView {
  id: string;
  entryId: string;
  type: EntryTransactionType;
  chips: number;
  amount: number;
  voided: boolean;
  voidsTransactionId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface OperationalActionView {
  id: string;
  type: string;
  actorName: string | null;
  deviceName: string | null;
  summary: string;
  createdAt: string;
  resultVersion: number;
  undoable: boolean;
  compensatedByActionId: string | null;
  compensatesActionId: string | null;
}

export interface FloorRequestView {
  id: string;
  tableId: string;
  tableNumber: number;
  kind: "CALL_FLOOR" | "BUST_REPORT";
  seatNumber: number | null;
  message: string | null;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  createdAt: string;
}

export interface ResultView {
  playerId: string;
  playerName: string;
  position: number;
  entries: number;
  points: number | null;
  prizeAmount: number | null;
  status: ResultStatus;
  revision: number;
}

export interface AnnouncementView {
  id: string;
  tournamentId: string | null;
  venueId: string | null;
  body: string;
  severity: Severity;
  channels: string[];
  createdAt: string;
  displayUntil: string | null;
}

/** Complete snapshot for staff surfaces. */
export interface TournamentSnapshot {
  tournament: TournamentDetailView;
  clock: ClockView;
  levels: LevelView[];
  stats: TournamentStats;
  tables: TableView[];
  registrations: RegistrationView[];
  entries: EntryView[];
  floorRequests: FloorRequestView[];
  announcements: AnnouncementView[];
  serverTime: string;
}

/** Public projection for TV displays and player live pages (no personal data). */
export interface PublicLiveSnapshot {
  tournament: Pick<
    TournamentDetailView,
    "id" | "name" | "status" | "format" | "gameType" | "startAt" | "startingStack" | "buyIn" | "lateRegistrationClosed" | "version"
  > & { venueName: string; organizationName: string };
  clock: ClockView;
  levels: LevelView[];
  stats: TournamentStats;
  announcements: AnnouncementView[];
  seating: { playerName: string; tableNumber: number; seatNumber: number }[] | null;
  results: { position: number; playerName: string }[];
  mySeat: { tableNumber: number; seatNumber: number } | null;
  myRegistration: { status: RegistrationStatus; checkInCode: string | null } | null;
  serverTime: string;
}

export interface MeView {
  user: { id: string; email: string; displayName: string; isSuperAdmin: boolean } | null;
  organization: { id: string; name: string; slug: string } | null;
  memberships: { organizationId: string; organizationName: string; roles: string[] }[];
  roles: string[];
  permissions: Permission[];
  venueIds: string[] | null;
  player: { id: string; displayName: string; externalPublicId: string } | null;
  featureFlags: FeatureFlags | null;
  csrfToken: string;
}

export interface CommandResult<T = unknown> {
  actionId: string;
  tournamentVersion: number;
  duplicate: boolean;
  result: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    currentVersion?: number;
  };
}
