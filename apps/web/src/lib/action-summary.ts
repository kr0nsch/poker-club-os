// Operational action summaries are written by the server in English: they are part of the audit
// trail and read the same on every device. The UI translates the known templates; anything else
// (e.g. a raw command type) is shown as stored.

type Translate = (text: string, vars?: Record<string, string | number | null | undefined>) => string;

/** [pattern, template key, names of the captured groups] */
const RULES: [RegExp, string, ...string[]][] = [
  [/^Level (\d+) started$/, "Level {n} started", "n"],
  [/^Level (\d+) break started$/, "Break started after level {n}", "n"],
  [/^Advanced to level (\d+)$/, "Advanced to level {n}", "n"],
  [/^Advanced to break$/, "Advanced to the break"],
  [/^Back to level (\d+)$/, "Back to level {n}", "n"],
  [/^Back to break$/, "Back to the break"],
  [/^Clock set to level (\d+)$/, "Clock set to level {n}", "n"],
  [/^Clock set to break$/, "Clock set to the break"],
  [/^Added (\d+)s$/, "Added {n} s", "n"],
  [/^Removed (\d+)s$/, "Removed {n} s", "n"],
  [/^Remaining time set to (\d+)s$/, "Remaining time set to {n} s", "n"],
  [/^Eliminated: (.+)$/, "Eliminated: {names}", "names"],
  [/^Restored (.+?): (.+)$/, "Restored {name}: {reason}", "name", "reason"],
  [/^Seat (\d+) marked present$/, "Seat {n} marked present", "n"],
  [/^Seat (\d+) marked absent$/, "Seat {n} marked absent", "n"],
  [/^Floor called to table (\d+)$/, "Floor called to table {n}", "n"],
  [/^Bust reported at table (\d+) seat (\d+)$/, "Bust reported at table {table} seat {seat}", "table", "seat"],
  [/^Movement confirmed at table (\d+)$/, "Movement confirmed at table {n}", "n"],
  [/^Floor request acknowledged$/, "Floor request acknowledged"],
  [/^Floor request resolved$/, "Floor request resolved"],
  [/^Rebuy: (.+)$/, "Rebuy: {name}", "name"],
  [/^Add-on: (.+)$/, "Add-on: {name}", "name"],
  [/^Chip adjustment ([+-]?\d+): (.+)$/, "Chip adjustment {chips}: {name}", "chips", "name"],
  [/^Voided (\w+) transaction$/, "Voided {type} transaction", "type"],
  [/^Entry voided: (.+)$/, "Entry voided: {reason}", "reason"],
  [/^Seating started \((\d+) players seated\)$/, "Seating started ({n} players seated)", "n"],
  [/^Tournament finished \((\d+) players ranked\)$/, "Tournament finished ({n} players ranked)", "n"],
  [/^Tournament reopened: (.+)$/, "Tournament reopened: {reason}", "reason"],
  [/^Results finalized \((\d+) players\)$/, "Results finalized ({n} players)", "n"],
  [/^Tournament cancelled: (.+)$/, "Tournament cancelled: {reason}", "reason"],
  [/^Result corrected: position (\d+) → (\d+)$/, "Result corrected: position {from} → {to}", "from", "to"],
  [/^(.+) registered \(waitlist\)$/, "{name} registered (waitlist)", "name"],
  [/^(.+) registered$/, "{name} registered", "name"],
  [/^Registration cancelled: (.+)$/, "Registration cancelled: {name}", "name"],
  [/^(.+) checked in → table (\d+) seat (\d+)$/, "{name} checked in → table {table} seat {seat}", "name", "table", "seat"],
  [/^(.+) checked in$/, "{name} checked in", "name"],
  [/^Check-in undone: (.+)$/, "Check-in undone: {name}", "name"],
  [/^No-show: (.+)$/, "No-show: {name}", "name"],
  [/^Promoted from waitlist: (.+)$/, "Promoted from waitlist: {name}", "name"],
  [/^Entry #(\d+): (.+)$/, "Entry #{n}: {name}", "n", "name"],
  [/^Re-entry #(\d+): (.+)$/, "Re-entry #{n}: {name}", "n", "name"],
  [/^(\d+) table\(s\) added$/, "{n} table(s) added", "n"],
  [/^Table (\d+) closed$/, "Table {n} closed", "n"],
  [/^Table (\d+) seat (\d+) locked$/, "Table {table} seat {seat} locked", "table", "seat"],
  [/^Table (\d+) seat (\d+) unlocked$/, "Table {table} seat {seat} unlocked", "table", "seat"],
  [/^Table (\d+) button → seat (\d+)$/, "Table {table}: button on seat {seat}", "table", "seat"],
  [/^Seat draw: (\d+) players seated, (\d+) tables opened$/, "Seat draw: {n} players seated, {tables} tables opened", "n", "tables"],
  [/^Seat draw: (\d+) players seated$/, "Seat draw: {n} players seated", "n"],
  [/^Seat draw applied: (\d+) players$/, "Seat draw applied: {n} players", "n"],
  [/^Seated at table (\d+) seat (\d+)$/, "Seated at table {table} seat {seat}", "table", "seat"],
  [/^Moved (.+): T(\d+)\/S(\d+) → T(\d+)\/S(\d+)$/, "Moved {name}: T{ft}/S{fs} → T{tt}/S{ts}", "name", "ft", "fs", "tt", "ts"],
  [/^Tables balanced: (\d+) move\(s\)$/, "Tables balanced: {n} move(s)", "n"],
  [/^Table (\d+) broken: (\d+) player\(s\) moved$/, "Table {table} broken: {n} player(s) moved", "table", "n"],
];

/** Balance plan explanation (packages/domain/src/balancing.ts), translated like the summaries. */
export function moveExplanation(text: string, t: Translate): string {
  const m = /^Table (\d+) has (\d+) players, table (\d+) has (\d+) \(imbalance (\d+) > (\d+)\); moving (.+) to (.+)$/.exec(text);
  if (!m) return t(text);
  const [, from, fromCount, to, toCount, spread, max, who, where] = m;
  return t("Table {from} has {fromCount} players, table {to} has {toCount} (imbalance {spread} > {max}); moving {who} to {where}", {
    from,
    fromCount,
    to,
    toCount,
    spread,
    max,
    who: t(who!),
    where: t(where!),
  });
}

const BREAK_STRATEGY: Record<string, string> = {
  HIGHEST_NUMBER_FIRST: "Highest table number first",
  LOWEST_NUMBER_FIRST: "Lowest table number first",
  FEWEST_PLAYERS_FIRST: "Table with the fewest players first",
};

/** Table break recommendation reason (packages/domain/src/table-break.ts). */
export function breakReason(text: string, t: Translate): string {
  let m = /^(\d+) players fit on (\d+) tables; break table (\d+) \((\w+)\)$/.exec(text);
  if (m) return t("{n} players fit on {tables} tables — break table {table} ({strategy})", { n: m[1], tables: m[2], table: m[3], strategy: t(BREAK_STRATEGY[m[4]!] ?? m[4]!).toLowerCase() });
  m = /^(\d+) players remain; final table forms at (\d+)$/.exec(text);
  if (m) return t("{n} players remain; the final table forms at {size}", { n: m[1], size: m[2] });
  m = /^(\d+) players need (\d+) tables$/.exec(text);
  if (m) return t("{n} players need {tables} tables", { n: m[1], tables: m[2] });
  return t(text);
}

export function actionSummary(summary: string, t: Translate): string {
  const undo = /^Undo: (.+)$/.exec(summary);
  if (undo) return t("Undone: {summary}", { summary: actionSummary(undo[1]!, t) });
  for (const [re, key, ...names] of RULES) {
    const m = re.exec(summary);
    if (m) return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  // Fixed summaries ("Clock paused", "Tournament started", …) are translation keys themselves.
  return t(summary);
}
