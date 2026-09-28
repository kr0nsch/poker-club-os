// Announcements (spec §30, §70): one domain announcement fans out to TV
// displays and player live pages immediately over the LAN, and — asynchronously,
// via the outbox — to Telegram. A Telegram failure can never roll back or delay
// the local announcement.

import { announcements, tournaments, venues } from "@pcos/db";
import { AnnouncementInput, topic, type AnnouncementView } from "@pcos/types";
import { and, desc, eq } from "drizzle-orm";
import { assertResourceAccess, requireOrganization, requirePermission, type Actor } from "../actor.js";
import { writeAudit } from "../audit.js";
import type { CoreDeps } from "../deps.js";
import { AppError, notFound, validation } from "../errors.js";
import { publishEvents } from "../events.js";
import type { OrgService } from "./org.service.js";

export class AnnouncementService {
  constructor(
    private readonly deps: CoreDeps,
    private readonly org: OrgService,
  ) {}

  async create(actor: Actor, raw: unknown): Promise<AnnouncementView> {
    requirePermission(actor, "announcement.create");
    const orgId = requireOrganization(actor);
    const input = AnnouncementInput.parse(raw);
    if (!input.tournamentId && !input.venueId) throw validation("an announcement needs a tournament or a venue");
    let venueId = input.venueId ?? null;
    if (input.tournamentId) {
      const [t] = await this.deps.db.select().from(tournaments).where(and(eq(tournaments.id, input.tournamentId), eq(tournaments.organizationId, orgId)));
      if (!t) throw notFound("tournament");
      venueId = t.venueId;
    } else {
      const [v] = await this.deps.db.select().from(venues).where(and(eq(venues.id, venueId!), eq(venues.organizationId, orgId)));
      if (!v) throw notFound("venue");
    }
    assertResourceAccess(actor, orgId, venueId);
    if (input.channels.includes("TELEGRAM")) {
      requirePermission(actor, "telegram.announce");
      const flags = await this.org.featureFlags(orgId);
      if (!flags.telegram) throw new AppError("FEATURE_DISABLED", "Telegram integration is disabled");
    }
    const now = this.deps.now();
    return this.deps.db.transaction(async (tx) => {
      const [a] = await tx
        .insert(announcements)
        .values({
          organizationId: orgId,
          venueId,
          tournamentId: input.tournamentId ?? null,
          body: input.body,
          severity: input.severity,
          channels: input.channels,
          createdBy: actor.userId,
          createdAt: now,
          displayUntil: new Date(now.getTime() + input.displaySeconds * 1000),
        })
        .returning();
      const view: AnnouncementView = {
        id: a!.id,
        tournamentId: a!.tournamentId,
        venueId: a!.venueId,
        body: a!.body,
        severity: a!.severity as AnnouncementView["severity"],
        channels: a!.channels,
        createdAt: a!.createdAt.toISOString(),
        displayUntil: a!.displayUntil?.toISOString() ?? null,
      };
      const topics = [...(input.tournamentId ? [topic.tournament(input.tournamentId)] : []), ...(venueId ? [topic.venue(venueId)] : [])];
      await publishEvents(
        tx,
        { organizationId: orgId, venueId, edgeNodeId: this.deps.edgeNodeId },
        [{ name: "announcement.created", topics, audience: "public", data: view, aggregateType: "announcement", aggregateId: a!.id }],
        now,
      );
      await writeAudit(tx, actor, this.deps.edgeNodeId, { organizationId: orgId, venueId, tournamentId: input.tournamentId ?? null, entityType: "announcement", entityId: a!.id, action: "ANNOUNCEMENT_CREATED", after: input }, now);
      return view;
    });
  }

  async list(actor: Actor, filter: { tournamentId?: string; venueId?: string }) {
    requirePermission(actor, "tournament.read");
    const orgId = requireOrganization(actor);
    return this.deps.db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.organizationId, orgId),
          filter.tournamentId ? eq(announcements.tournamentId, filter.tournamentId) : undefined,
          filter.venueId ? eq(announcements.venueId, filter.venueId) : undefined,
        ),
      )
      .orderBy(desc(announcements.createdAt))
      .limit(100);
  }
}
