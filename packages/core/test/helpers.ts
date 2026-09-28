import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import {
  createDb,
  organizationSettings,
  organizations,
  players,
  structureLevels,
  tournamentClockStates,
  tournamentStructures,
  tournaments,
  venues,
  type DbHandle,
} from "@pcos/db";
import { createTestDatabase } from "@pcos/testkit";
import {
  DEFAULT_ADDON,
  DEFAULT_BOUNTY,
  DEFAULT_LATE_REG,
  DEFAULT_REBUY,
  DEFAULT_REENTRY,
  TDA_2026_STYLE,
  permissionsForRoles,
  type CommandType,
} from "@pcos/types";
import type { Actor } from "../src/actor.js";

export async function testDb(): Promise<DbHandle & { url: string; drop(): Promise<void> }> {
  const { url, drop } = await createTestDatabase(inject("pgBaseUrl"));
  const handle = createDb(url, { max: 8, applicationName: "pcos-test" });
  return {
    ...handle,
    url,
    drop: async () => {
      await handle.close();
      await drop();
    },
  };
}

export function staffActor(organizationId: string, roles: string[] = ["TOURNAMENT_DIRECTOR"], userId: string | null = null, deviceId: string | null = null): Actor {
  return {
    principal: { kind: "staff", userId: userId ?? randomUUID(), organizationId, roles, permissions: permissionsForRoles(roles), venueIds: null },
    userId,
    deviceId,
    ip: "192.168.10.50",
    channel: "WEB",
  };
}

export async function seedOrg(db: DbHandle["db"], opts: { levels?: { type: "PLAY" | "BREAK"; durationSeconds: number; bigBlind?: number }[]; players?: number } = {}) {
  const [org] = await db.insert(organizations).values({ name: "Royal Poker Club", slug: `royal-${randomUUID().slice(0, 8)}` }).returning();
  await db.insert(organizationSettings).values({ organizationId: org!.id });
  const [venue] = await db.insert(venues).values({ organizationId: org!.id, name: "Main Room", slug: "main" }).returning();
  const [structure] = await db.insert(tournamentStructures).values({ organizationId: org!.id, name: "Turbo" }).returning();
  const levels = opts.levels ?? [
    { type: "PLAY", durationSeconds: 1200, bigBlind: 200 },
    { type: "PLAY", durationSeconds: 1200, bigBlind: 400 },
    { type: "BREAK", durationSeconds: 600 },
    { type: "PLAY", durationSeconds: 1200, bigBlind: 800 },
  ];
  await db.insert(structureLevels).values(
    levels.map((l, i) => ({
      structureId: structure!.id,
      position: i,
      type: l.type,
      smallBlind: l.type === "PLAY" ? (l.bigBlind ?? 200) / 2 : 0,
      bigBlind: l.type === "PLAY" ? (l.bigBlind ?? 200) : 0,
      durationSeconds: l.durationSeconds,
    })),
  );
  const playerRows = await db
    .insert(players)
    .values(
      Array.from({ length: opts.players ?? 20 }, (_, i) => ({
        organizationId: org!.id,
        externalPublicId: `P-${randomUUID().slice(0, 8).toUpperCase()}`,
        firstName: `Player`,
        lastName: `${i + 1}`,
        displayName: `Player ${i + 1}`,
        searchText: `player ${i + 1}`,
      })),
    )
    .returning();
  return { org: org!, venue: venue!, structure: structure!, players: playerRows };
}

export async function seedTournament(
  db: DbHandle["db"],
  base: Awaited<ReturnType<typeof seedOrg>>,
  overrides: Partial<typeof tournaments.$inferInsert> = {},
) {
  const [t] = await db
    .insert(tournaments)
    .values({
      organizationId: base.org.id,
      venueId: base.venue.id,
      structureId: base.structure.id,
      houseRules: { ...TDA_2026_STYLE },
      name: "Sunday Main Event",
      slug: `sunday-${randomUUID().slice(0, 6)}`,
      startAt: new Date(Date.now() + 3600_000),
      startingStack: 20000,
      tableSize: 9,
      lateRegistrationPolicy: { ...DEFAULT_LATE_REG, untilLevel: 2 },
      reentryPolicy: DEFAULT_REENTRY,
      rebuyPolicy: DEFAULT_REBUY,
      addonPolicy: DEFAULT_ADDON,
      bountyPolicy: DEFAULT_BOUNTY,
      ...overrides,
    })
    .returning();
  await db.insert(tournamentClockStates).values({ tournamentId: t!.id });
  return t!;
}

export function cmd<T extends CommandType>(type: T, payload: Record<string, unknown>, expectedVersion: number) {
  return { type, payload, expectedVersion, clientOperationId: randomUUID() };
}
