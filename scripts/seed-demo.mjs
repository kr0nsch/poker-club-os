// Demo data for development and demos, created through the real HTTP API.
//   node --env-file=.env scripts/seed-demo.mjs [--api http://127.0.0.1:4000]
// Requires SETUP_TOKEN in the environment when the server has not been set up yet.

const apiArg = process.argv.indexOf("--api");
const base = apiArg > 0 ? process.argv[apiArg + 1] : (process.env.SEED_API_URL ?? "http://127.0.0.1:4000");
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "td@royal.example", password: process.env.SEED_ADMIN_PASSWORD ?? "correct-horse-battery", displayName: "Anna TD" };

let cookie = "";
let csrf = "";
async function call(method, path, body, { allow = [] } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json().catch(() => null);
  if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

let version = 0;
async function cmd(tid, type, payload = {}) {
  const r = await call("POST", `/api/v1/tournaments/${tid}/commands`, { type, payload, expectedVersion: version, clientOperationId: crypto.randomUUID() });
  version = r.tournamentVersion;
  return r.result;
}
async function refreshVersion(tid) {
  version = (await call("GET", `/api/v1/tournaments/${tid}/snapshot`)).tournament.version;
}

const setup = await call("GET", "/api/v1/auth/setup");
if (setup.needsSetup) {
  if (!process.env.SETUP_TOKEN) throw new Error("server needs setup: set SETUP_TOKEN (see the API console)");
  await call("POST", "/api/v1/auth/setup", {
    setupToken: process.env.SETUP_TOKEN,
    organization: { name: "Royal Poker Club", slug: "royal" },
    venue: { name: "Main Room", slug: "main", timezone: "Europe/Moscow", localHostname: process.env.LOCAL_HOSTNAME || "poker.royalclub.example" },
    edgeNode: { name: "Mini PC (edge)" },
    admin: ADMIN,
  });
  console.log("setup completed");
}
const me = await call("POST", "/api/v1/auth/login", { email: ADMIN.email, password: ADMIN.password });
csrf = me.csrfToken;

const existing = await call("GET", "/api/v1/tournaments");
if (existing.length > 0 && !process.argv.includes("--force")) {
  console.log(`already seeded (${existing.length} tournaments); use --force to add more`);
  process.exit(0);
}

const [venue] = await call("GET", "/api/v1/venues");
const [structure] = await call("GET", "/api/v1/structures");
const [rule] = await call("GET", "/api/v1/score-rules");

// Staff accounts for every role that works on the floor.
for (const s of [
  { email: "floor@royal.example", displayName: "Boris Floor", roles: ["FLOOR_MANAGER"] },
  { email: "desk@royal.example", displayName: "Olga Desk", roles: ["REGISTRATION_STAFF", "CASHIER"] },
  { email: "dealer@royal.example", displayName: "Igor Dealer", roles: ["DEALER"] },
]) {
  await call("POST", "/api/v1/staff", { ...s, password: ADMIN.password, venueIds: null }, { allow: [409] });
}

// League + season covering this year.
const year = new Date().getFullYear();
const league = await call("POST", "/api/v1/leagues", { name: "Royal League", description: "Season ranking of the club", scoreRuleId: rule.id, bestResultsCount: 10 });
const season = await call("POST", `/api/v1/leagues/${league.id}/seasons`, { name: `Season ${year}`, startsOn: `${year}-01-01`, endsOn: `${year}-12-31` });

const first = ["Alexei", "Maria", "Dmitri", "Olga", "Sergei", "Anna", "Ivan", "Elena", "Pavel", "Irina", "Nikolai", "Tatiana", "Mikhail", "Svetlana", "Andrei", "Natalia", "Yuri", "Ekaterina", "Boris", "Galina", "Oleg", "Vera", "Roman", "Daria", "Artem", "Polina", "Kirill", "Alina"];
const last = ["Smirnov", "Ivanova", "Kuznetsov", "Popova", "Sokolov", "Lebedeva", "Kozlov", "Novikova", "Morozov", "Petrova", "Volkov", "Solovyova", "Vasiliev", "Zaitseva", "Pavlov", "Semenova", "Golubev", "Vinogradova", "Bogdanov", "Vorobyova", "Fedorov", "Mikhailova", "Belyaev", "Tarasova", "Orlov", "Kiseleva", "Makarov", "Andreeva"];
const nicks = ["Shark", null, "RiverRat", null, "AceHigh", null, "Grinder", "Queenie", null, null, "TheRock", null, "BigSlick", null, null, "Nuts", null, null, "Bluffer", null, "Donk", null, "Maniac", null, "Fish", null, "Rounder", null];
const players = [];
for (let i = 0; i < first.length; i++) {
  players.push(
    await call("POST", "/api/v1/players", {
      firstName: first[i],
      lastName: last[i],
      nickname: nicks[i],
      phone: `+7 900 ${String(1000000 + i * 7919).slice(0, 7)}`,
      email: `${first[i].toLowerCase()}.${last[i].toLowerCase()}@example.com`,
      memberNumber: `M${1001 + i}`,
      marketingConsent: i % 3 === 0,
      tags: i % 5 === 0 ? ["VIP"] : i % 4 === 0 ? ["Regular"] : undefined,
    }),
  );
}
console.log(`${players.length} players`);

const hour = 3600_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

// 1. A running re-entry tournament with 24 seated players.
const main = await call("POST", "/api/v1/tournaments", {
  name: "Sunday Main Event",
  description: "Weekly flagship tournament",
  venueId: venue.id,
  structureId: structure.id,
  format: "REENTRY",
  startAt: iso(-0.25 * hour),
  startingStack: 30000,
  tableSize: 9,
  maxPlayers: 60,
  buyIn: { amount: 300000, fee: 30000, currency: "RUB" },
  lateRegistrationPolicy: { enabled: true, closeMode: "LEVEL", untilLevel: 4 },
  reentryPolicy: { enabled: true, maxReentries: 2, closeMode: "WITH_LATE_REGISTRATION" },
  addonPolicy: { enabled: true, afterLevel: 4, maxAddons: 1, chips: 20000, amount: 200000 },
  seasonId: season.id,
});
version = main.version;
await cmd(main.id, "PUBLISH");
await cmd(main.id, "OPEN_REGISTRATION");
for (const p of players.slice(0, 24)) {
  const r = await cmd(main.id, "REGISTER_PLAYER", { playerId: p.id, source: "STAFF" });
  await cmd(main.id, "CHECK_IN", { registrationId: r.registrationId, createEntry: true, seat: "NONE" });
}
await cmd(main.id, "START_SEATING", { draw: true });
await cmd(main.id, "START_TOURNAMENT");
console.log(`running: ${main.name}`);

// 2. Registration open for tonight.
const turbo = await call("POST", "/api/v1/tournaments", {
  name: "Monday Turbo",
  venueId: venue.id,
  structureId: structure.id,
  format: "FREEZEOUT",
  startAt: iso(6 * hour),
  startingStack: 20000,
  maxPlayers: 27,
  buyIn: { amount: 150000, fee: 15000, currency: "RUB" },
  seasonId: season.id,
});
version = turbo.version;
await cmd(turbo.id, "PUBLISH");
await cmd(turbo.id, "OPEN_REGISTRATION");
for (const p of players.slice(10, 18)) await cmd(turbo.id, "REGISTER_PLAYER", { playerId: p.id, source: "PLAYER_WEB" });

// 3. Scheduled for later this week.
const deep = await call("POST", "/api/v1/tournaments", {
  name: "Wednesday Deepstack",
  venueId: venue.id,
  structureId: structure.id,
  format: "REBUY",
  startAt: iso(50 * hour),
  startingStack: 50000,
  rebuyPolicy: { enabled: true, maxRebuys: 3, untilLevel: 6, chips: 50000, amount: 200000 },
  buyIn: { amount: 200000, fee: 20000, currency: "RUB" },
});
version = deep.version;
await cmd(deep.id, "PUBLISH");

// Devices for the venue.
const display = await call("POST", "/api/v1/display-tokens", { name: "TV main hall", kind: "DISPLAY", venueId: venue.id });
const kiosk = await call("POST", "/api/v1/display-tokens", { name: "Entrance kiosk", kind: "KIOSK", venueId: venue.id });
await refreshVersion(main.id);

console.log("\nDemo ready:");
console.log(`  staff login   ${ADMIN.email} / ${ADMIN.password}`);
console.log(`  TV display    ${display.path}`);
console.log(`  kiosk         ${kiosk.path}`);
console.log(`  player pages  /p/royal`);
