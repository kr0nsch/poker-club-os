# Edge ↔ cloud sync

> **Scope.** This repository contains only the **edge side** of cloud synchronisation
> ([packages/core/src/services/sync.service.ts](../packages/core/src/services/sync.service.ts)). **No cloud
> service is included.** This document specifies the HTTP protocol the edge speaks so that a cloud
> control plane can be implemented against it ([ASSUMPTIONS.md](ASSUMPTIONS.md)).

Cloud sync is optional and never on the critical path. A venue works indefinitely without it; events
that have not been synchronised are kept, never discarded. The architecture context is in
[ARCHITECTURE.md](ARCHITECTURE.md), the entities in [DOMAIN_MODEL.md](DOMAIN_MODEL.md).

## Overview

```
 edge (worker)                                       cloud (not in this repo)
 ─────────────                                       ────────────────────────
 outbox_events (syncable, PENDING/FAILED)
   └─ every SYNC_PUSH_INTERVAL_MS ── POST /v1/edge/events ──▶ store, dedupe by eventId
                                   ◀── { acked: [eventId…] } ─┘
   mark SYNCED

 sync_cursors "cloud-pull".token
   └─ every SYNC_PULL_INTERVAL_MS ── GET /v1/edge/changes?cursor=… ──▶
                                   ◀── { changes: […], nextCursor } ──┘
   apply / skip / record conflict
```

## Enabling

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLOUD_SYNC_ENABLED` | `false` | Master switch |
| `CLOUD_API_URL` | unset | Base URL of the cloud API (a trailing `/` is ignored); use HTTPS |
| `CLOUD_SYNC_TOKEN` | unset | Bearer token presented by this edge node |
| `SYNC_PUSH_INTERVAL_MS` | `10000` | Push cadence (not in `.env.example`) |
| `SYNC_PULL_INTERVAL_MS` | `60000` | Pull cadence (not in `.env.example`) |
| `EDGE_NODE_ID` | `edge-dev` | Sent as `nodeId` and `X-Edge-Node`; keep it stable for the life of the venue |

Sync is active only when **all three** of `CLOUD_SYNC_ENABLED=true`, `CLOUD_API_URL` and
`CLOUD_SYNC_TOKEN` are set. The worker runs push and pull only while the WAN monitor reports the
Internet as available ([OFFLINE_OPERATION.md](OFFLINE_OPERATION.md)). Enable it **after** the first-run
setup (see [Pull](#pull-cloud--edge)).

## The outbox

Every domain event is inserted into `outbox_events` in the same PostgreSQL transaction as the state
change it describes ([REALTIME.md](REALTIME.md)). Relevant columns:

| Column | Meaning |
| --- | --- |
| `seq` | Edge-local, strictly increasing sequence (bigserial) |
| `event_id` | UUID, unique per event: the idempotency key for the cloud |
| `aggregate_type`, `aggregate_id`, `entity_version` | Which entity changed and its version after the change (may be null) |
| `event_type`, `payload` | Event name and JSON data |
| `syncable` | Replicate to the cloud (default `true`) |
| `sync_status` | `PENDING`, `FAILED`, `SYNCED`, or `SKIPPED` (non-syncable events) |
| `sync_attempts`, `last_error`, `synced_at` | Push bookkeeping |

Some events exist only for sync (not broadcast locally), for example `player.created`,
`player.updated` (payload: `id`, `externalPublicId`, `memberNumber`, `firstName`, `lastName`,
`displayName`, `nickname`, `email`, `phone`, `status`, `marketingConsent`, `version`),
`player.anonymized`, `tournament.created`, `tournament.configured`, `structure.updated`. Tournament
command events (registration, seating, clock, eliminations, …) are both broadcast and synced unless a
handler marks them otherwise. Personal data in these payloads is covered in [PRIVACY.md](PRIVACY.md).

## Push (edge → cloud)

### Request

```http
POST {CLOUD_API_URL}/v1/edge/events
Authorization: Bearer {CLOUD_SYNC_TOKEN}
Content-Type: application/json
X-Edge-Node: {EDGE_NODE_ID}
```

Body: `{ "nodeId": "<EDGE_NODE_ID>", "events": [ … ] }`, each event:

| Field | Type | Notes |
| --- | --- | --- |
| `eventId` | UUID string | Globally unique; dedupe on this |
| `seq` | integer | Edge-local order; ascending within a batch |
| `organizationId`, `venueId` | UUID or `null` | Tenant scope |
| `aggregateType`, `aggregateId` | string | e.g. `player` / `<uuid>` |
| `eventType` | string | e.g. `player.updated` |
| `entityVersion` | integer or `null` | Version after the change |
| `payload` | object | Event data |
| `occurredAt` | ISO 8601 UTC | Commit time on the edge |

Batching: the edge reads up to 500 syncable `PENDING`/`FAILED` events in `seq` order and sends a
contiguous prefix of at most **200 events** and about **512 KiB** (payload size + 300 bytes per event;
the first event is always included). One batch is sent per push interval; the request times out after
15 seconds.

### Response

`2xx` with a JSON body `{ "acked": ["<eventId>", …] }`.

| Outcome | Edge behaviour |
| --- | --- |
| `eventId` listed in `acked` | Event marked `SYNCED` (`synced_at`, error cleared) |
| Event in the batch but not acked | Left as it was (`PENDING`/`FAILED`) and sent again next time; cursor error `partial acknowledgement` |
| Non-2xx, invalid JSON, network error or timeout | Whole batch marked `FAILED`, `sync_attempts + 1`, `last_error` stored; retried on the next tick |

After a response the `cloud-push` cursor in `sync_cursors` advances to the highest `seq` of the
**contiguous** acknowledged prefix (informational; selection is by `sync_status`), and
`venue_edge_nodes.last_cloud_sync_at` is updated when anything was acknowledged. There is no retry cap
and no back-off beyond the push interval: events stay queued until acknowledged.

### Idempotency rules for implementers

- Deduplicate by `eventId` and acknowledge events you already stored. The edge re-sends when a
  response is lost, when only part of a batch was acknowledged, and after `KEEP_LOCAL` conflict
  resolutions (see below).
- Do not key events by `(nodeId, seq)`: after a database restore the sequence continues from the dump,
  so a `seq` value can be reused by a different event.
- Acknowledge only what is durably stored. Out-of-order acknowledgement is allowed.

## Pull (cloud → edge)

### Request

```http
GET {CLOUD_API_URL}/v1/edge/changes?cursor={token}
Authorization: Bearer {CLOUD_SYNC_TOKEN}
X-Edge-Node: {EDGE_NODE_ID}
```

`cursor` is omitted until the cloud has returned one. One page is fetched per pull interval (15 s
timeout). There is no immediate pull when the Internet returns; the next scheduled pull runs.

### Response

`{ "changes": [ … ], "nextCursor": "<opaque>" | null }`. Each change:

| Field | Type | Meaning |
| --- | --- | --- |
| `entityType` | string | `player` or `tournament`; anything else is recorded as a conflict |
| `entityId` | UUID string | Local id of the entity (used as the id when a player is created) |
| `organizationId` | UUID string | Club the change belongs to |
| `remoteVersion` | integer | Entity version in the cloud after the change |
| `baseVersion` | integer or `null` | Edge version the cloud based its change on |
| `originNodeId` | string | Node where the change originated; equal to this `EDGE_NODE_ID` means echo |
| `payload` | object | New field values |

Changes are processed in order, each in its own transaction. After the whole page the edge stores
`nextCursor` (or keeps the previous token if it is `null`). On an HTTP or network error only the
cursor's `last_error` is updated; the token stays and nothing is applied. If applying a change throws,
the cursor is not advanced and the page is fetched again on the next pull; the cloud should therefore
tolerate re-delivery of a page (player changes that were already applied are then skipped as "already
applied").

### Decision rules

Tenant guard first:

1. Edge node not registered yet (first-run setup not done): **skip**. The cursor still advances past
   the page, so enable sync only after setup.
2. `organizationId` is not the club this edge node serves: **reject**, recorded as a conflict under
   the edge's own club ("organization … is not served by this edge node").
3. The local player/tournament with that id belongs to another club: **reject** ("entity belongs to
   another organization").

Then `decideInbound` ([packages/domain/src/sync.ts](../packages/domain/src/sync.ts)); "last synced
version" is the highest `entity_version` of a `SYNCED` outbox event for the entity:

| Order | Condition | Result |
| --- | --- | --- |
| 1 | `originNodeId` equals this node | Skip (echo of a local change) |
| 2 | Entity does not exist locally | Apply |
| 3 | Entity locked by live operations (tournament not `DRAFT`/`SCHEDULED`) | Reject → conflict |
| 4 | `remoteVersion` ≤ local version and ≤ last synced version | Skip (already applied) |
| 5 | Edge changed the entity since its last synced version and `baseVersion` ≠ local version | Conflict |
| 6 | otherwise | Apply |

What "apply" does:

| Entity | Fields taken from `payload` | Notes |
| --- | --- | --- |
| `player` (existing) | `firstName`, `lastName`, `displayName`, `nickname`, `email`, `phone`, `memberNumber`, `status`, `marketingConsent` | Version becomes max(local + 1, `remoteVersion`) |
| `player` (new) | same, plus `externalPublicId` (default `P-<first 8 chars of id>`) | Created with `source = CLOUD` |
| `tournament` (existing, `DRAFT`/`SCHEDULED`) | `name`, `description`, `maxPlayers`, `expectedPlayers`, `startAt` (ISO string) | Version + 1 |
| `tournament` (unknown locally) | – | Recorded as conflict "remote tournament creation requires manual import" |

An applied player change is recorded as a `player.updated` outbox event that is already `SYNCED`: it
becomes the new sync base and is never echoed back. Live tournament state is authoritative on the edge
and cannot be changed from the cloud.

## Conflicts

Rejected and conflicting changes are stored in `sync_conflicts` (entity, local and remote versions,
local and remote payloads, reason, detection time). Nothing is silently dropped.

**Admin → Health & backups → Sync conflicts** (permission `sync.manage`) lists them, shows local and
cloud JSON side by side with the differing fields highlighted, and resolves them:

| Resolution | Effect |
| --- | --- |
| `KEEP_LOCAL` | The latest outbox event this node produced for the entity is set back to `PENDING`, so the edge version is pushed again and the cloud can converge |
| `ACCEPT_REMOTE` | Players only: `firstName`, `lastName`, `displayName`, `nickname`, `email`, `phone`, `memberNumber` from the cloud payload are written to the local player of the administrator's club (version + 1). Other entity types are not changed automatically; edit them by hand |
| `MANUAL` | Marked as handled without any automatic change |

Every resolution stores who resolved it, when and an optional note, and writes the audit entry
`SYNC_CONFLICT_RESOLVED` ([SECURITY.md](SECURITY.md)). A resolved conflict cannot be resolved again.

API ([API.md](API.md)):

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/edge/sync` | `edge.read` | Enabled flag, cloud URL, counts (pending, failed, synced, oldest pending), open conflicts, cursors |
| `GET /api/v1/edge/sync/conflicts` | `sync.manage` | Latest 200 conflicts of the club |
| `POST /api/v1/edge/sync/conflicts/{id}/resolve` | `sync.manage` | Body `{ "resolution": "KEEP_LOCAL" \| "ACCEPT_REMOTE" \| "MANUAL", "note"?: string }` |

## What never syncs

- **Non-syncable events** (`syncable: false`, stored as `SKIPPED`): local realtime signals such as
  `edge.status.updated`, `session.revoked`, `device.updated`, dealer floor requests and table presence
  updates, and the realtime-only `tournament.updated` broadcasts (their sync counterparts are
  `tournament.created` / `tournament.configured`).
- **Everything that is not an outbox event**, including sessions and password hashes, the device
  registry, display and kiosk link secrets, kiosk PINs and fields outside the player sync payload, the
  notification queue and Telegram deliveries, the Telegram bot token and other integration secrets, the
  audit log, backups, uploaded files and the `.env` configuration.

## When sync is disabled or offline

| Situation | Behaviour |
| --- | --- |
| Sync disabled | Push and pull do nothing. Syncable events still accumulate as `PENDING`; housekeeping only deletes `SYNCED`/`SKIPPED` events older than 30 days, so pending events are kept. Enabling sync later uploads this history in `seq` order. Edge status reports `cloudSync.enabled = false` and `pending = 0`; health component `cloud_sync` is `DISABLED` |
| Internet down | Loops are skipped; events queue as `PENDING`/`FAILED`. Devices show *LOCAL · OFFLINE*; health `cloud_sync` is `DEGRADED` while events are pending |
| Internet back | The WAN monitor triggers an immediate push; regular intervals continue until the backlog is drained (at most 200 events per interval) |
| Cloud returns errors | Batch `FAILED`, retried every push interval; `last_error` shown under **Cloud sync** on the health page |

Staff see the state in **Admin → Health & backups → Cloud sync** (pending, failed, synced, oldest unsent
change, cursors with last errors) and in the connectivity badge (*LOCAL · SYNCING* while events are
pending and sync is enabled).

## Security notes

- The bearer token authenticates the edge node; store it only in `.env` (diagnostics show it as
  `<set>`). Rotate it on the cloud side and in `.env` together.
- Use an HTTPS `CLOUD_API_URL` with a publicly trusted certificate; the worker uses Node's built-in
  `fetch`, which verifies it.
- The cloud must enforce tenant scoping by token/node as well; the edge-side tenant guard only protects
  the edge ([SECURITY.md](SECURITY.md), [NETWORK_SECURITY.md](NETWORK_SECURITY.md)).

## Evidence

| Test | Shows |
| --- | --- |
| [tests/e2e/wan-recovery.test.ts](../tests/e2e/wan-recovery.test.ts) | Every syncable event recorded during an Internet outage reaches the (mock) cloud after the WAN returns; `cloudSync.pending` returns to 0 |
| [packages/core/test/sync.test.ts](../packages/core/test/sync.test.ts) | Apply based on the current version, echo skip, conflict on diverged edits and its resolution, live tournament protection, cross-club rejection, creation of cloud-only players |
| [packages/domain/test/notifications-sync.test.ts](../packages/domain/test/notifications-sync.test.ts) | Decision rules, batching limits, contiguous cursor advance |
