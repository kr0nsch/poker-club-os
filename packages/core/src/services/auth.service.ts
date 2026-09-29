// Authentication, sessions, first-run setup and player self-signup (spec §37, §87).
//
// Sessions: random 256-bit token in an httpOnly cookie; only its SHA-256 is
// stored. Every session also has a CSRF token (synchronizer pattern) that
// clients echo in X-CSRF-Token for state-changing requests. The LAN is not
// trusted: the same rules apply to requests from inside the venue.

import {
  displayTemplates,
  houseRulesProfiles,
  organizationMembers,
  organizationSettings,
  organizations,
  playerConsents,
  players,
  scoreRules,
  sessions,
  structureLevels,
  systemKv,
  tournamentStructures,
  users,
  venueEdgeNodes,
  venues,
} from "@pcos/db";
import { type Principal } from "@pcos/domain";
import {
  DEFAULT_FEATURE_FLAGS,
  PlayerSignupInput,
  SetupInput,
  STAFF_ROLES,
  TDA_2026_STYLE,
  permissionsForRoles,
  type FeatureFlags,
  type LoginInput,
  type MeView,
  type Permission,
} from "@pcos/types";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import { hashPassword, randomCode, randomToken, safeEqual, sha256, verifyPassword } from "../crypto.js";
import type { CoreDeps } from "../deps.js";
import { AppError, forbidden, unauthenticated, validation } from "../errors.js";

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
  /** staff principal when the user holds staff roles in the session organization */
  staff: Extract<Principal, { kind: "staff" }> | null;
  /** player principal when the user has a player profile in the session organization */
  player: Extract<Principal, { kind: "player" }> | null;
}

const LOGIN_WINDOW_S = 300;
const MAX_FAILURES_BEFORE_LOCK = 10;
const LOCK_MINUTES = 15;
const SESSION_TOUCH_INTERVAL_MS = 60_000;

export class AuthService {
  private readonly touchCache = new Map<string, number>();

  constructor(private readonly deps: CoreDeps) {}

  // --- first-run setup ------------------------------------------------------------------

  async needsSetup(): Promise<boolean> {
    const [row] = await this.deps.db.select({ n: sql<number>`count(*)::int` }).from(users);
    return (row?.n ?? 0) === 0;
  }

  /**
   * Ensure a setup token exists while setup is pending. Returns the plaintext
   * token only when it was generated now (to be printed on the server console).
   */
  async ensureSetupToken(): Promise<string | null> {
    if (!(await this.needsSetup())) return null;
    if (this.deps.config.SETUP_TOKEN) {
      await this.deps.db
        .insert(systemKv)
        .values({ key: "setup.tokenHash", value: sha256(this.deps.config.SETUP_TOKEN) })
        .onConflictDoUpdate({ target: systemKv.key, set: { value: sha256(this.deps.config.SETUP_TOKEN), updatedAt: this.deps.now() } });
      return null;
    }
    const [existing] = await this.deps.db.select().from(systemKv).where(eq(systemKv.key, "setup.tokenHash"));
    if (existing) return null;
    const token = randomCode(6) + "-" + randomCode(6) + "-" + randomCode(6);
    await this.deps.db.insert(systemKv).values({ key: "setup.tokenHash", value: sha256(token) }).onConflictDoNothing();
    return token;
  }

  async initialize(raw: unknown, actor: Actor) {
    const input = SetupInput.parse(raw);
    if (!(await this.needsSetup())) throw new AppError("SETUP_ALREADY_COMPLETED", "setup has already been completed");
    const [stored] = await this.deps.db.select().from(systemKv).where(eq(systemKv.key, "setup.tokenHash"));
    if (!stored || !safeEqual(String(stored.value), sha256(input.setupToken))) {
      await this.deps.rateLimiter.hit(`setup:${actor.ip}`, 5, 900);
      throw forbidden("invalid setup token (see the edge server console / SETUP_TOKEN)");
    }
    const limited = await this.deps.rateLimiter.hit(`setup:${actor.ip}`, 10, 900);
    if (!limited.allowed) throw new AppError("RATE_LIMITED", "too many setup attempts");

    const passwordHash = await hashPassword(input.admin.password);
    const now = this.deps.now();
    const result = await this.deps.db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({ name: input.organization.name, slug: input.organization.slug }).returning();
      await tx.insert(organizationSettings).values({ organizationId: org!.id, featureFlags: { ...DEFAULT_FEATURE_FLAGS }, timezone: input.venue.timezone });
      const localUrl = input.venue.localHostname ? `https://${input.venue.localHostname}` : (this.deps.config.LOCAL_APP_URL ?? null);
      const [venue] = await tx
        .insert(venues)
        .values({
          organizationId: org!.id,
          name: input.venue.name,
          slug: input.venue.slug,
          timezone: input.venue.timezone,
          localHostname: input.venue.localHostname ?? this.deps.config.LOCAL_HOSTNAME ?? null,
          localUrl,
          publicUrl: this.deps.config.APP_URL ?? null,
        })
        .returning();
      await tx
        .insert(venueEdgeNodes)
        .values({
          organizationId: org!.id,
          venueId: venue!.id,
          nodeId: this.deps.edgeNodeId,
          name: input.edgeNode.name,
          status: "ONLINE",
          softwareVersion: this.deps.config.SOFTWARE_VERSION,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({ target: venueEdgeNodes.nodeId, set: { organizationId: org!.id, venueId: venue!.id, name: input.edgeNode.name } });
      const [user] = await tx
        .insert(users)
        .values({ email: input.admin.email, passwordHash, displayName: input.admin.displayName })
        .returning();
      await tx.insert(organizationMembers).values({ organizationId: org!.id, userId: user!.id, roles: ["ORGANIZATION_OWNER"] });

      // Sensible defaults so the first tournament can be created immediately.
      await tx.insert(houseRulesProfiles).values({ organizationId: org!.id, name: "TDA 2026 style", preset: "TDA_2026_STYLE", config: TDA_2026_STYLE, isDefault: true });
      await tx.insert(displayTemplates).values({
        organizationId: org!.id,
        name: "Standard clock",
        widgets: ["CLOCK", "BLINDS", "NEXT_LEVEL", "NEXT_BREAK", "ENTRIES", "REMAINING", "AVERAGE_STACK", "ANNOUNCEMENTS", "LOGO"],
        theme: { accent: "#d4ae5c", background: "#0b0c0e" },
      });
      await tx.insert(scoreRules).values({
        organizationId: org!.id,
        name: "Standard league points",
        kind: "FORMULA",
        config: { expression: "max(0, 10 * sqrt(entrants) / sqrt(position) - 1) + 1", minPoints: 1, roundTo: 2 },
      });
      const [structure] = await tx.insert(tournamentStructures).values({ organizationId: org!.id, name: "Standard 20-minute levels" }).returning();
      await tx.insert(structureLevels).values(defaultStructure().map((l, i) => ({ ...l, structureId: structure!.id, position: i })));
      await tx.delete(systemKv).where(eq(systemKv.key, "setup.tokenHash"));
      await tx.insert(systemKv).values({ key: "setup.completedAt", value: now.toISOString() }).onConflictDoNothing();
      return { org: org!, venue: venue!, user: user! };
    });
    await writeAudit(this.deps.db, { ...actor, userId: result.user.id }, this.deps.edgeNodeId, {
      organizationId: result.org.id,
      venueId: result.venue.id,
      entityType: "organization",
      entityId: result.org.id,
      action: "SETUP_COMPLETED",
      after: { organization: input.organization, venue: { name: input.venue.name, slug: input.venue.slug }, admin: input.admin.email },
    });
    return result;
  }

  // --- login / sessions -------------------------------------------------------------------

  async login(input: LoginInput, ctx: { ip: string | null; userAgent: string | null; deviceId: string | null }) {
    const ipKey = `login:ip:${ctx.ip ?? "unknown"}`;
    const idKey = `login:id:${input.email}:${ctx.ip ?? "unknown"}`;
    const [byIp, byId] = [await this.deps.rateLimiter.hit(ipKey, 30, LOGIN_WINDOW_S), await this.deps.rateLimiter.hit(idKey, 8, LOGIN_WINDOW_S)];
    if (!byIp.allowed || !byId.allowed) {
      throw new AppError("RATE_LIMITED", `too many login attempts, retry in ${Math.max(byIp.retryAfterSeconds, byId.retryAfterSeconds)}s`);
    }
    const [user] = await this.deps.db.select().from(users).where(eq(users.email, input.email));
    const now = this.deps.now();
    const auditActor: Actor = { principal: { kind: "anonymous" }, userId: user?.id ?? null, deviceId: ctx.deviceId, ip: ctx.ip, channel: "WEB" };
    if (user?.lockedUntil && user.lockedUntil > now) {
      throw new AppError("RATE_LIMITED", "account temporarily locked after repeated failures");
    }
    const ok = await verifyPassword(user?.passwordHash ?? null, input.password);
    if (!user || !ok || user.status !== "ACTIVE") {
      if (user) {
        const failures = user.failedLoginCount + 1;
        await this.deps.db
          .update(users)
          .set({ failedLoginCount: failures, lockedUntil: failures >= MAX_FAILURES_BEFORE_LOCK ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null })
          .where(eq(users.id, user.id));
      }
      await writeAudit(this.deps.db, auditActor, this.deps.edgeNodeId, {
        organizationId: null,
        entityType: "user",
        entityId: user?.id ?? null,
        action: "LOGIN_FAILED",
        metadata: { email: input.email, reason: !user ? "unknown_user" : user.status !== "ACTIVE" ? "disabled" : "bad_password" },
      });
      throw unauthenticated("invalid email or password");
    }

    const orgId = await this.pickOrganization(user.id, input.organizationSlug);
    const { token, session } = await this.createSession(user.id, orgId, ctx, "STAFF");
    await this.deps.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
    await writeAudit(this.deps.db, { ...auditActor, sessionId: session.id }, this.deps.edgeNodeId, {
      organizationId: orgId,
      entityType: "user",
      entityId: user.id,
      action: "LOGIN",
    });
    return { token, session, user };
  }

  private async pickOrganization(userId: string, slug?: string): Promise<string | null> {
    const memberships = await this.deps.db
      .select({ organizationId: organizationMembers.organizationId, slug: organizations.slug })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "ACTIVE")));
    if (slug) {
      const m = memberships.find((x) => x.slug === slug);
      if (m) return m.organizationId;
    }
    if (memberships[0]) return memberships[0].organizationId;
    const [player] = await this.deps.db
      .select({ organizationId: players.organizationId, slug: organizations.slug })
      .from(players)
      .innerJoin(organizations, eq(organizations.id, players.organizationId))
      .where(eq(players.userId, userId));
    return player?.organizationId ?? null;
  }

  async createSession(
    userId: string,
    organizationId: string | null,
    ctx: { ip: string | null; userAgent: string | null; deviceId: string | null },
    kind: "STAFF" | "PLAYER" | "TELEGRAM",
  ) {
    const token = randomToken(32);
    const now = this.deps.now();
    const [session] = await this.deps.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: sha256(token),
        organizationId,
        deviceId: ctx.deviceId,
        kind,
        csrfToken: randomToken(24),
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + this.deps.config.SESSION_TTL_HOURS * 3600_000),
      })
      .returning();
    return { token, session: session! };
  }

  async logout(sessionId: string) {
    await this.deps.db.update(sessions).set({ revokedAt: this.deps.now() }).where(eq(sessions.id, sessionId));
  }

  /** Revoke every active session of a user (optionally keeping one). Returns revoked session ids. */
  async revokeUserSessions(userId: string, exceptSessionId?: string) {
    const rows = await this.deps.db
      .update(sessions)
      .set({ revokedAt: this.deps.now() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined))
      .returning({ id: sessions.id });
    return rows.map((r) => r.id);
  }

  /** Resolve a session token into user + principals, or null if invalid. */
  async resolve(token: string | undefined | null): Promise<ResolvedSession | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const now = this.deps.now();
    const [row] = await this.deps.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
    if (!row || row.u.status !== "ACTIVE") return null;

    const last = this.touchCache.get(row.s.id) ?? row.s.lastSeenAt?.getTime() ?? 0;
    if (now.getTime() - last > SESSION_TOUCH_INTERVAL_MS) {
      this.touchCache.set(row.s.id, now.getTime());
      await this.deps.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id));
    }
    return { session: row.s, user: row.u, ...(await this.principalsFor(row.u, row.s.organizationId)) };
  }

  /** Re-read a session after it changed (e.g. organization switch). */
  async resolveBySessionId(sessionId: string): Promise<ResolvedSession | null> {
    const [row] = await this.deps.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, this.deps.now())));
    if (!row) return null;
    return { session: row.s, user: row.u, ...(await this.principalsFor(row.u, row.s.organizationId)) };
  }

  async principalsFor(user: UserRow, organizationId: string | null) {
    let staff: ResolvedSession["staff"] = null;
    let player: ResolvedSession["player"] = null;
    if (organizationId) {
      const [m] = await this.deps.db
        .select()
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, user.id), eq(organizationMembers.status, "ACTIVE")));
      const staffRoles = (m?.roles ?? []).filter((r) => r !== "PLAYER");
      if (staffRoles.length > 0 || user.isSuperAdmin) {
        const custom = await this.customRolePermissions(organizationId, staffRoles);
        staff = {
          kind: "staff",
          userId: user.id,
          organizationId,
          roles: staffRoles,
          permissions: permissionsForRoles(staffRoles, custom),
          venueIds: m?.venueIds ?? null,
          isSuperAdmin: user.isSuperAdmin,
        };
      }
      const [p] = await this.deps.db
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.organizationId, organizationId), eq(players.userId, user.id)));
      if (p) player = { kind: "player", userId: user.id, organizationId, playerId: p.id };
    }
    return { staff, player };
  }

  private async customRolePermissions(organizationId: string, roleKeys: string[]): Promise<Record<string, string[]>> {
    const custom = roleKeys.filter((r) => !(STAFF_ROLES as readonly string[]).includes(r));
    if (custom.length === 0) return {};
    const rows = await this.deps.db.execute<{ key: string; permission: string }>(sql`
      select r.key, rp.permission from roles r join role_permissions rp on rp.role_id = r.id
      where r.organization_id = ${organizationId}`);
    const out: Record<string, string[]> = {};
    for (const r of rows.rows) (out[r.key] ??= []).push(r.permission);
    return out;
  }

  async me(resolved: ResolvedSession | null): Promise<MeView> {
    if (!resolved) {
      return { user: null, organization: null, memberships: [], roles: [], permissions: [], venueIds: null, player: null, featureFlags: null, csrfToken: "" };
    }
    const memberships = await this.deps.db
      .select({ organizationId: organizationMembers.organizationId, organizationName: organizations.name, roles: organizationMembers.roles })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(eq(organizationMembers.userId, resolved.user.id), eq(organizationMembers.status, "ACTIVE")));
    const orgId = resolved.session.organizationId;
    const [org] = orgId ? await this.deps.db.select().from(organizations).where(eq(organizations.id, orgId)) : [];
    const [settings] = orgId ? await this.deps.db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, orgId)) : [];
    let player: MeView["player"] = null;
    if (resolved.player) {
      const [p] = await this.deps.db.select().from(players).where(eq(players.id, resolved.player.playerId));
      if (p) player = { id: p.id, displayName: p.displayName, externalPublicId: p.externalPublicId };
    }
    return {
      user: { id: resolved.user.id, email: resolved.user.email, displayName: resolved.user.displayName, isSuperAdmin: resolved.user.isSuperAdmin },
      organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
      memberships,
      roles: resolved.staff ? [...resolved.staff.roles] : [],
      permissions: resolved.staff ? ([...resolved.staff.permissions] as Permission[]) : [],
      venueIds: resolved.staff?.venueIds ? [...resolved.staff.venueIds] : null,
      player,
      featureFlags: settings ? ({ ...DEFAULT_FEATURE_FLAGS, ...(settings.featureFlags as Partial<FeatureFlags>) } as FeatureFlags) : null,
      csrfToken: resolved.session.csrfToken,
    };
  }

  async switchOrganization(resolved: ResolvedSession, organizationId: string) {
    const [m] = await this.deps.db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, resolved.user.id), eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.status, "ACTIVE")));
    const [p] = await this.deps.db.select().from(players).where(and(eq(players.userId, resolved.user.id), eq(players.organizationId, organizationId)));
    if (!m && !p && !resolved.user.isSuperAdmin) throw forbidden("not a member of this organization");
    await this.deps.db.update(sessions).set({ organizationId }).where(eq(sessions.id, resolved.session.id));
  }

  async changePassword(resolved: ResolvedSession, currentPassword: string, newPassword: string) {
    if (!(await verifyPassword(resolved.user.passwordHash, currentPassword))) throw unauthenticated("current password is incorrect");
    await this.deps.db.update(users).set({ passwordHash: await hashPassword(newPassword), updatedAt: this.deps.now() }).where(eq(users.id, resolved.user.id));
    // Every other session (possibly on a lost device) is signed out.
    return this.revokeUserSessions(resolved.user.id, resolved.session.id);
  }

  // --- player self-signup (works entirely on the LAN) ---------------------------------------

  async signupPlayer(raw: unknown, ctx: { ip: string | null; userAgent: string | null; deviceId: string | null }) {
    const input = PlayerSignupInput.parse(raw);
    const rl = await this.deps.rateLimiter.hit(`signup:${ctx.ip}`, 10, 3600);
    if (!rl.allowed) throw new AppError("RATE_LIMITED", "too many sign-ups from this address");
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.slug, input.organizationSlug));
    if (!org) throw validation("unknown organization");
    const [settings] = await this.deps.db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, org.id));
    const flags = { ...DEFAULT_FEATURE_FLAGS, ...((settings?.featureFlags ?? {}) as Partial<FeatureFlags>) };
    if (!flags.playerRegistration) throw new AppError("FEATURE_DISABLED", "player registration is disabled");
    const [existingUser] = await this.deps.db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existingUser) throw new AppError("DUPLICATE", "an account with this email already exists — please sign in");

    const passwordHash = await hashPassword(input.password);
    const now = this.deps.now();
    const { user, player } = await this.deps.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email: input.email, passwordHash, displayName: `${input.firstName} ${input.lastName}` }).returning();
      // An existing CRM record with the same email is claimed by the new account.
      const [existingPlayer] = await tx.select().from(players).where(and(eq(players.organizationId, org.id), eq(players.email, input.email)));
      let player;
      if (existingPlayer && !existingPlayer.userId) {
        [player] = await tx.update(players).set({ userId: user!.id, updatedAt: now, version: existingPlayer.version + 1 }).where(eq(players.id, existingPlayer.id)).returning();
      } else {
        const displayName = input.nickname || `${input.firstName} ${input.lastName.charAt(0)}.`;
        [player] = await tx
          .insert(players)
          .values({
            organizationId: org.id,
            externalPublicId: `P-${randomCode(8)}`,
            userId: user!.id,
            firstName: input.firstName,
            lastName: input.lastName,
            displayName,
            nickname: input.nickname || null,
            email: input.email,
            phone: input.phone || null,
            source: "PLAYER_WEB",
            marketingConsent: input.marketingConsent,
            searchText: [input.firstName, input.lastName, input.nickname, input.email, input.phone].filter(Boolean).join(" ").toLowerCase(),
          })
          .returning();
      }
      await tx.insert(playerConsents).values([
        { organizationId: org.id, playerId: player!.id, type: "PRIVACY_POLICY", granted: true, source: "PLAYER_WEB", createdAt: now },
        { organizationId: org.id, playerId: player!.id, type: "MARKETING", granted: input.marketingConsent, source: "PLAYER_WEB", createdAt: now },
      ]);
      await tx.insert(organizationMembers).values({ organizationId: org.id, userId: user!.id, roles: ["PLAYER"] }).onConflictDoNothing();
      return { user: user!, player: player! };
    });
    const { token, session } = await this.createSession(user.id, org.id, ctx, "PLAYER");
    await writeAudit(this.deps.db, { principal: { kind: "anonymous" }, userId: user.id, deviceId: ctx.deviceId, ip: ctx.ip, channel: "WEB" }, this.deps.edgeNodeId, {
      organizationId: org.id,
      entityType: "player",
      entityId: player.id,
      action: "PLAYER_SIGNUP",
      metadata: { marketingConsent: input.marketingConsent },
    });
    return { token, session, user, player };
  }
}

/** Default 20-minute structure created during setup. */
function defaultStructure() {
  const blinds = [
    [100, 200],
    [200, 300],
    [200, 400],
    [300, 600],
    [400, 800],
    [500, 1000],
    [600, 1200],
    [800, 1600],
    [1000, 2000],
    [1500, 3000],
    [2000, 4000],
    [3000, 6000],
    [4000, 8000],
    [5000, 10000],
    [6000, 12000],
    [8000, 16000],
  ];
  const out: { type: string; smallBlind: number; bigBlind: number; ante: number; anteType: string; durationSeconds: number; label: string | null }[] = [];
  blinds.forEach(([sb, bb], i) => {
    out.push({ type: "PLAY", smallBlind: sb!, bigBlind: bb!, ante: i >= 3 ? bb! : 0, anteType: i >= 3 ? "BIG_BLIND" : "NONE", durationSeconds: 1200, label: null });
    if (i === 3 || i === 7 || i === 11) out.push({ type: "BREAK", smallBlind: 0, bigBlind: 0, ante: 0, anteType: "NONE", durationSeconds: 600, label: i === 3 ? "Break — late registration closes" : "Break" });
  });
  return out;
}
