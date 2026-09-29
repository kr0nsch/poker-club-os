# Seating engine

Sources: `packages/domain/src/seating.ts`, `balancing.ts`, `table-break.ts`, `rng.ts` (pure
planners); `packages/core/src/tournaments/ops.ts` (`applyMove`, `seatEntry`, `releaseSeat`,
`addTables`), `handlers/seating.ts`, `handlers/lifecycle.ts` (`drawSeating`), `handlers/dealer.ts`,
`handlers/elimination.ts`; previews in `packages/core/src/services/tournament.service.ts`.

Related: [TOURNAMENT_STATE_MACHINE.md](TOURNAMENT_STATE_MACHINE.md), [DOMAIN_MODEL.md](DOMAIN_MODEL.md#25-live-operation),
[API.md](API.md#7-tournament-command-catalogue), [REALTIME.md](REALTIME.md).

---

## 1. Model and principles

| Concept | Storage | Rules |
|---|---|---|
| Table | `tournament_tables` | Numbered per tournament, capacity 2–11 (default `tournaments.table_size`), status `OPEN` → `ACTIVE` (first player seated) → `BREAKING` → `CLOSED`. Only `OPEN` and `ACTIVE` tables accept players. |
| Seat | `(table_id, seat_number)`, 1…capacity | A seat is *open* when it is neither occupied nor locked. |
| Assignment | `tournament_seat_assignments` | One `ACTIVE` row per occupied seat and per entry (partial unique indexes `seat_active_seat_uq`, `seat_active_entry_uq`). Moving or releasing sets the old row to `RELEASED`. |
| Movement | `seat_movements` | One row per seat change: from/to table and seat, reason (`INITIAL_SEATING`, `LATE_REGISTRATION`, `BALANCE`, `TABLE_BREAK`, `MANUAL`, `CORRECTION`, `RESTORE`), `action_id`, `confirmed_at`. |
| Seat lock | `tournament_seat_locks` | Seat excluded from every automatic choice. |
| Dealer button | `tournament_tables.dealer_button_seat` | Set manually (`SET_DEALER_BUTTON`); used only by balancing. The engine never moves it. |

Principles:

- Planners in `packages/domain` are pure: they receive a snapshot of tables (`SeatingTable`: seats map,
  locked seats, status, button) and return a list of moves. They never touch the database.
- Plans computed on the server during a command are applied immediately inside that command's
  transaction. Plans shown to the operator first (previews) are applied by `STRICT` commands that must
  carry the tournament version the preview was based on (`basedOnVersion`), and are re-validated
  move by move (`validatePlan`) before being applied.
- Every applied move goes through `applyMove()`, which releases the old assignment, inserts the new
  one, marks an `OPEN` table `ACTIVE`, records a `seat_movements` row and emits `seat.assigned`
  (no previous seat) or `seat.moved`.
- Randomness comes from `createCryptoRng()` (Web Crypto `getRandomValues` with rejection sampling for
  unbiased integers). A fresh RNG is created per command and per preview; the seeded PRNG exists only
  for tests.

---

## 2. Initial seating

### Automatic draw (`drawSeating`)

Used by `START_SEATING` (when `draw` is true, the default), `START_TOURNAMENT` (always) and
`APPLY_INITIAL_SEATING { generate: true }`. It seats every `ACTIVE` entry that has no seat yet:

1. Required tables = `max(1, ceil((seated + unseated) / table_size))`. Missing `OPEN`/`ACTIVE` tables are
   created with capacity `table_size`, numbered after the highest existing table number.
2. `planInitialSeating()` builds the plan. If locked seats leave too little capacity it reports
   `additionalTablesNeeded = ceil((n − open seats) / max capacity)`; the handler opens that many more
   tables and plans again.
3. Moves are applied with reason `INITIAL_SEATING`; the conflict key `seating` is touched.

### Planner (`planInitialSeating`)

Controlled by the house rule `randomInitialSeating` (default `true`):

| Mode | Behaviour |
|---|---|
| Random | Entries are shuffled (Fisher–Yates with the CSPRNG). Each entry goes to the table with the fewest players among tables with an open seat (ties broken randomly), on a random open seat. This keeps tables balanced during the draw. |
| In order | Entries in the given order (entry creation time); each takes the lowest-numbered table with an open seat and its lowest open seat. |

Locked seats are never used.

### Preview and apply

`GET /api/v1/tournaments/:id/seating/preview` (permission `seat.assign`) returns `basedOnVersion`,
the number of unseated entries, usable tables, tables needed, `additionalTablesNeeded` and a plan on
the current tables built by the same planner and house rule (no tables are created by a preview; the
plan is empty when capacity is insufficient). `APPLY_INITIAL_SEATING { moves }` (`STRICT`) applies such a plan: every move must start
from "unseated" (`fromTableId = null`), and the plan is validated against the current seat map; a stale
plan fails with `409 VERSION_CONFLICT` ("plan is no longer valid: …").

---

## 3. Late registration and new entries

Entries created by `CHECK_IN { createEntry: true }` or `CREATE_ENTRY` are seated according to the
`seat` target (default `"AUTO"`); `RESTORE_PLAYER` uses the same function when the original seat is
gone.

| Target | Behaviour |
|---|---|
| `"NONE"` | Not seated. |
| `"AUTO"` | Only after seating has started (status `SEATING`, `RUNNING`, `BREAK`, `PAUSED`, `HAND_FOR_HAND`); before that the entry waits for the draw. The seat is chosen by `chooseSeatForNewEntry` with the house rule `lateRegistrationSeatPolicy`. If no open seat exists, one new table is opened and the choice is repeated. |
| `{ tableId, seatNumber }` | The table must exist, the seat must be within capacity and not locked; the table must accept players; an occupied seat fails with `409 VERSION_CONFLICT` (unique index). |

`lateRegistrationSeatPolicy`:

| Value | Choice |
|---|---|
| `SHORTEST_TABLE_RANDOM_SEAT` (default) | Table with the fewest players among `OPEN`/`ACTIVE` tables with an open seat (ties random), then a random open seat. |
| `RANDOM_OPEN_SEAT` | Uniformly random among all open seats of all `OPEN`/`ACTIVE` tables. |

The movement reason is `LATE_REGISTRATION` when the tournament is live, otherwise `INITIAL_SEATING`
(`RESTORE` for restores).

`ASSIGN_SEAT { entryId, seat }` (permission `seat.assign`) seats an `ACTIVE`, currently unseated entry
manually: `"AUTO"` uses the same policy with reason `MANUAL` but does **not** open a table (fails with
"no open seat; add a table first"); `"NONE"` is rejected.

---

## 4. Table balancing

### Analysis (`analyzeBalance`)

Considers tables with status `OPEN` or `ACTIVE` that have at least one player or are `ACTIVE` (an
`ACTIVE` table that has become empty keeps counting as 0 players until it is closed with
`CLOSE_TABLE`).

| Output | Definition |
|---|---|
| `imbalance` | players at the fullest table − players at the emptiest table |
| `balanced` | `imbalance ≤ maxTableImbalance` (house rule, 1–5, default 1) |
| `severe` | `imbalance ≥ severeImbalanceThreshold` (house rule, 2–9, default 3) |
| `maxTable`, `minTable`, `playersSeated`, `activeTables` | informational |

With fewer than two such tables the result is always balanced.

### Recommendation (`recommendBalanceMoves`)

Repeats until balanced (at most 500 iterations), simulating each move before choosing the next:

1. **Source**: the table with the most players (ties: higher table number).
2. **Destination**: among the other tables with an open seat, the one with the fewest players (ties:
   lower table number). Stop if none exists or the spread is ≤ `maxTableImbalance`.
3. **Player** (house rule `balancePlayerSelection`):
   - `BIG_BLIND_NEXT` (default): the player due to post the big blind on the next hand. With the button
     on seat B, occupied seats are listed clockwise after B; the current hand's blinds are the 1st and
     2nd, so the next big blind is the 3rd. With one or two players the last listed seat is used. If
     the button is unknown, a random player is chosen.
   - `RANDOM`: a random player at the source table.
4. **Destination seat**: the open seat that reaches the big blind soonest — the first open seat
   clockwise after the destination table's current big blind (the 2nd occupied seat after its button,
   or the only occupied seat). If the destination's button is unknown or no one is seated there, a
   random open seat.

Each move carries a human-readable `explanation` (table counts, imbalance, why this player and seat).
The house rule `tableBalanceStrategy` has a single value (`MOVE_FROM_LONGEST_TO_SHORTEST`) and is not
read by the code.

### Preview and apply

`GET /api/v1/tournaments/:id/balance/preview` (permission `seat.move`) returns `basedOnVersion`, the
analysis, `haltPlay` (`severe && haltPlayOnSevereImbalance`), the recommended moves (empty when
balanced) with player names and table numbers, and the current table-break recommendation.
`APPLY_BALANCE { moves }` (1–200 moves, `STRICT`, permission `seat.move`) validates and applies them
with reason `BALANCE` and touches the key `balance`.

`haltPlayOnSevereImbalance` only sets the `haltPlay` hint (also returned by `ELIMINATE_PLAYERS`); the
server does not pause the clock or block commands.

After each elimination, `ELIMINATE_PLAYERS` returns `hints`: `balanceNeeded`, `imbalance`,
`severeImbalance`, `haltPlay` and a `tableBreak` recommendation, so the floor UI can prompt the
director. Nothing is moved automatically.

---

## 5. Table breaking

### Recommendation (`recommendTableBreak`)

Only `OPEN`/`ACTIVE` tables with at least one player are considered; with fewer than two there is
nothing to break.

1. Candidate by house rule `tableBreakStrategy`:
   `HIGHEST_NUMBER_FIRST` (default), `LOWEST_NUMBER_FIRST`, or `FEWEST_PLAYERS_FIRST` (ties: higher
   table number).
2. If exactly two tables remain, `finalTableSize` is set and more than `finalTableSize` players remain
   → do not break yet ("final table forms at N").
3. Break only if the candidate's players fit into the open seats of the other occupied tables.

### Plan (`planTableBreak`)

Players of the breaking table leave in random order (seat-card draw). Each goes to the table with the
fewest players among all other `OPEN`/`ACTIVE` tables with an open seat (ties random), on a random open
seat. If the other tables do not have enough open seats the planner fails with `422 RULE_VIOLATION`.

### Preview and apply

`GET /api/v1/tournaments/:id/break/preview?tableId=` (permission `table.break`) plans the break of the
given table, or of the recommended one when `tableId` is omitted (no recommendation → empty plan).
`BREAK_TABLE { tableId, moves }` (≤ 20 moves, `STRICT`, permission `table.break`):

1. the table must not be `CLOSED`; every move must start at the breaking table;
2. the set of moved entries must equal the players currently seated there, otherwise
   `409 VERSION_CONFLICT` ("players at the table changed since the break was previewed");
3. the table is set to `BREAKING` (it cannot receive players), the plan is validated and applied with
   reason `TABLE_BREAK`;
4. the table is set to `CLOSED` and `table.updated` (public, `broken: true`) is published.

---

## 6. Final table

There is no dedicated final-table operation (not implemented). `finalTableSize` (house rule, 2–11 or
null) only affects the break recommendation above: with two tables left, the last break is recommended
when the remaining players number `finalTableSize` or fewer (and fit). A final-table redraw has to be
done with manual `MOVE_PLAYER` commands.

---

## 7. Seat locks

`SET_SEAT_LOCK { tableId, seatNumber, locked, reason? }` (permission `table.manage`) creates or removes a
row in `tournament_seat_locks`. It is rejected when the house rule `seatLockingEnabled` is `false`, or
when the seat number exceeds the capacity.

Effects of a lock:

- initial draw, late-registration seating, balancing destinations and break destinations never pick it;
- an explicit seat target or a `MOVE_PLAYER` / plan move into a locked seat is rejected;
- a restored player returns to the original seat only if it is not locked;
- locking an occupied seat does not move its occupant (no check); it only prevents new assignments.

`SET_SEAT_LOCK` is undoable (the previous lock state and reason are restored). It emits
`table.updated` with staff audience.

---

## 8. Dealer interface

Dealer commands require `dealer.table.operate` (roles `DEALER`, `FLOOR_MANAGER`,
`TOURNAMENT_DIRECTOR`, and above). Table restriction (`assertDealerTable`): if the actor lacks
`seat.move` and the request carries a device id (`X-Device-Id`) whose `devices.assigned_table_id` is set
to a different table, the command fails with `403 FORBIDDEN`. Actors with `seat.move`, requests
without a device id and unassigned devices may operate any table of the tournament. Device
identity supplements, never replaces, user authentication.

| Command | Effect |
|---|---|
| `DEALER_MARK_PRESENT { tableId, seatNumber, present }` | Sets `present` on the active assignment of that seat (empty seat → `422`). Event `table.updated` (staff, not synced to the cloud). |
| `DEALER_REQUEST_FLOOR { tableId, message? }` | Creates a `CALL_FLOOR` floor request; event `floor.request.created`. |
| `DEALER_REPORT_BUST { tableId, seatNumber }` | Creates a `BUST_REPORT` floor request with `message = "entry:<entryId>"`. It does **not** eliminate the player; the floor/TD confirms with `ELIMINATE_PLAYERS`. |
| `DEALER_CONFIRM_MOVEMENT { movementId }` | Sets `seat_movements.confirmed_at` (the destination table must be allowed for the device). Repeating it returns `alreadyConfirmed: true`. |
| `RESOLVE_FLOOR_REQUEST { requestId, resolution }` | `ACKNOWLEDGED` or `RESOLVED` (permission `seat.move`). Event `floor.request.updated`. |

Open floor requests (not `RESOLVED`) are part of the staff tournament snapshot. Dealer devices may
subscribe to `table:{id}` topics only for their assigned table ([REALTIME.md](REALTIME.md#4-topics-and-authorization)).

---

## 9. Manual table management

| Command | Permission | Behaviour |
|---|---|---|
| `ADD_TABLES { count 1–100, capacity? 2–11 }` | `table.manage` | Creates `OPEN` tables numbered after the highest existing number. |
| `CLOSE_TABLE { tableId }` | `table.manage` | Only an empty table; status `CLOSED`. |
| `SET_DEALER_BUTTON { tableId, seatNumber \| null }` | `table.manage` | Stores the button seat (null = unknown). |
| `MOVE_PLAYER { entryId, fromTableId, fromSeatNumber, toTableId, toSeatNumber, reason }` | `seat.move` | `reason` `MANUAL` (default) or `CORRECTION`. Validated like a plan: the entry must still be at the given seat and the destination must be an open, unlocked seat on a table that accepts players; otherwise `409 VERSION_CONFLICT`. Undoable. |

None of these commands has a tournament-status guard ([TOURNAMENT_STATE_MACHINE.md](TOURNAMENT_STATE_MACHINE.md#operational-commands-per-status)).

---

## 10. Concurrency

Commands of one tournament are serialised by the tournament row lock (`SELECT … FOR UPDATE`). On top
of that:

| Mechanism | Purpose |
|---|---|
| `STRICT` concurrency for `APPLY_INITIAL_SEATING`, `APPLY_BALANCE`, `BREAK_TABLE`, `START_SEATING` | Plans computed from a snapshot are only accepted on the exact version they were computed for. |
| `REBASE` for `MOVE_PLAYER`, `ASSIGN_SEAT`, `SET_SEAT_LOCK`, `ADD_TABLES`, `CLOSE_TABLE`, `SET_DEALER_BUTTON`, dealer commands, eliminations, entries | Accepted on a newer version unless an action since `expectedVersion` touched an overlapping key. |
| Seat-level conflict keys | `seat:{tableId}:{seatNumber}` for both the vacated and the occupied seat, plus `entry:{id}`. Two floor devices moving different players at the same table do not conflict; two moves into the same seat do. Other keys: `tables`, `table:{id}`, `table:{id}:button`, `seating`, `balance`, `presence:{tableId}:{seat}`, `movement:{id}`, `floor:{id}`. |
| Database indexes | `seat_active_seat_uq` / `seat_active_entry_uq` make a double assignment impossible even if the logic were wrong; a violation of the seat index is returned as `409 VERSION_CONFLICT` ("… is already occupied"). |
| Release check | Releasing the expected "from" seat updates only an `ACTIVE` row with that exact table/seat; if none matches the command fails with `409 VERSION_CONFLICT` ("player is no longer at the expected seat"). |

`tests/e2e/lan.test.ts` exercises two devices moving different players into the same seat concurrently:
exactly one succeeds, the other receives `409`.

---

## 11. Events and notifications

| Event | Audience | Topics |
|---|---|---|
| `seat.assigned`, `seat.moved`, `seat.released` | `public` when the `publicSeatList` feature flag is on (default), otherwise `staff` | `tournament:{id}` and `table:{id}` of the tables involved |
| `table.updated` | `public` for table creation, close and break; `staff` for locks, button, presence, movement confirmation | `tournament:{id}` (+ `table:{id}` except for created tables) |

The notification fan-out turns `seat.assigned` into `SEAT_ASSIGNED` and `seat.moved` with reason
`BALANCE`, `TABLE_BREAK` or `MANUAL` into `TABLE_MOVE` (in-app and Telegram; see [TELEGRAM.md](TELEGRAM.md)).
