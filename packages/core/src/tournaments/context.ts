import type { Tx } from "@pcos/db";
import type { ClockAnchor, DerivedClock, Rng } from "@pcos/domain";
import type { Audience, FeatureFlags, HouseRulesConfig, Permission, RealtimeEventName } from "@pcos/types";
import type { Actor } from "../actor.js";
import type { AuditEntry } from "../audit.js";
import type { LevelRow, TournamentRow } from "./repo.js";

export interface EmitInput {
  name: RealtimeEventName;
  data: unknown;
  audience?: Audience;
  /** extra topics in addition to tournament:{id} */
  topics?: string[];
  aggregateType?: string;
  aggregateId?: string;
  syncable?: boolean;
}

/** Everything a command handler may read or change. Effects are applied by the executor. */
export interface CommandContext {
  readonly tx: Tx;
  readonly now: Date;
  readonly nowMs: number;
  readonly actor: Actor;
  readonly actionId: string;
  readonly edgeNodeId: string;
  readonly rng: Rng;
  readonly flags: FeatureFlags;
  /** current tournament row including patches applied so far */
  readonly tournament: TournamentRow;
  readonly levels: readonly LevelRow[];
  readonly houseRules: HouseRulesConfig;
  /** clock anchor after auto-advance materialisation */
  readonly clock: ClockAnchor;
  /** derived clock at `now` */
  readonly derived: DerivedClock;
  /** true when this command materialised an automatic level change */
  readonly autoAdvanced: boolean;

  updateTournament(patch: Partial<TournamentRow>): void;
  setClock(anchor: ClockAnchor): void;
  emit(e: EmitInput): void;
  audit(e: Omit<AuditEntry, "organizationId" | "tournamentId" | "venueId">): void;
  /** declare entity keys touched (for REBASE conflict detection) */
  touch(...keys: string[]): void;
  summary(text: string): void;
  statsChanged(): void;
  compensates(actionId: string): void;
  require(permission: Permission): void;
  /** audience for seat/elimination events, depending on the public seat list flag */
  seatAudience(): Audience;
}
