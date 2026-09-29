// Spec §95: Telegram bot over long polling from the edge server — account
// linking, registration through inline buttons, idempotent handling of
// redelivered updates and safe defaults for staff commands.

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ApiClient, EdgeStack, enableTelegram, linkedPlayer, setupVenue, sleep, tgCallback, tgMessage, waitFor } from "./src/harness.js";

const LINKED = 6001;
const STRANGER = 6002;
const CODE_USER = 6003;

const stack = new EdgeStack({ telegram: true });
let td: ApiClient;
let tournamentId: string;
let player: Awaited<ReturnType<typeof linkedPlayer>>;

/** Push an update and wait for the bot's next message to that chat. */
async function ask(chatId: number, update: ReturnType<typeof tgMessage> | ReturnType<typeof tgCallback>) {
  const n = stack.telegram.messagesTo(chatId).length;
  stack.telegram.push(update);
  return waitFor(() => stack.telegram.messagesTo(chatId)[n], `bot reply to ${chatId}`);
}

const registrations = () => stack.query<{ status: string; source: string }>("select status, source from tournament_registrations where tournament_id = $1 and player_id = $2", [tournamentId, player.playerId]);

beforeAll(async () => {
  await stack.start(inject("pgBaseUrl"));
  const v = await setupVenue(stack);
  td = v.td;
  await enableTelegram(stack, td);
  player = await linkedPlayer(stack, LINKED, "Linked");
  const t = await td.post<{ id: string }>("/api/v1/tournaments", {
    name: "Friday Bounty",
    venueId: v.venueId,
    structureId: v.structureId,
    format: "FREEZEOUT",
    startAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    startingStack: 25000,
  });
  tournamentId = t.id;
  await td.commandOk(tournamentId, "PUBLISH");
  await td.commandOk(tournamentId, "OPEN_REGISTRATION");
});

afterAll(async () => {
  await stack.stop();
});

describe("Telegram bot (§95)", () => {
  it("links an account with a single-use deep link", async () => {
    const status = await player.web.get<{ linked: boolean }>("/api/v1/telegram/link");
    expect(status.linked).toBe(true);
    // The same link cannot be used twice (e.g. forwarded to someone else).
    const reply = await ask(STRANGER, tgMessage(STRANGER, `/start ${player.startPayload}`));
    expect(reply.text).toMatch(/expired or was already used/);
  });

  it("links an account with a code issued by the bot", async () => {
    const reply = await ask(CODE_USER, tgMessage(CODE_USER, "/link"));
    const code = /<code>([A-Z0-9]{8})<\/code>/.exec(reply.text)?.[1];
    expect(code).toBeTruthy();
    const web = new ApiClient(stack.url);
    await web.ok("POST", "/api/v1/auth/signup", { organizationSlug: "royal", email: "code@e2e.example", password: "correct-horse-battery", firstName: "Code", lastName: "User", acceptPrivacyPolicy: true });
    await web.post("/api/v1/telegram/link/code", { code });
    expect((await web.get<{ linked: boolean }>("/api/v1/telegram/link")).linked).toBe(true);
    // A code works once.
    const again = await web.call("POST", "/api/v1/telegram/link/code", { code });
    expect(again.status).toBe(400);
  });

  it("lists published tournaments", async () => {
    const reply = await ask(LINKED, tgCallback(LINKED, "ev"));
    expect(reply.text).toContain("Friday Bounty");
    expect(JSON.stringify(reply.replyMarkup)).toContain(`ev:${tournamentId}`);
  });

  it("refuses registration for accounts that are not linked", async () => {
    const reply = await ask(STRANGER, tgCallback(STRANGER, `rg:${tournamentId}`));
    expect(reply.text).toMatch(/Link your player account first/);
  });

  it("registers a linked player through the inline button", async () => {
    const reply = await ask(LINKED, tgCallback(LINKED, `rg:${tournamentId}`));
    expect(reply.text).toContain("Registered!");
    expect(await registrations()).toEqual([{ status: "REGISTERED", source: "TELEGRAM" }]);
    expect(stack.telegram.calls).toContain("answerCallbackQuery");
  });

  it("sends the registration confirmation exactly once", async () => {
    await waitFor(() => stack.telegram.messagesTo(LINKED).find((m) => m.text.includes("Registration confirmed")), "confirmation", 10_000);
    await sleep(1_500);
    expect(stack.telegram.messagesTo(LINKED).filter((m) => m.text.includes("Registration confirmed"))).toHaveLength(1);
  });

  it("ignores a redelivered update (no double registration, no second reply)", async () => {
    const update = tgCallback(LINKED, `rg:${tournamentId}`);
    await ask(LINKED, update);
    const replies = stack.telegram.messagesTo(LINKED).length;
    stack.telegram.push(update, true); // Telegram redelivers after a lost acknowledgement
    await sleep(2_500);
    expect(stack.telegram.messagesTo(LINKED)).toHaveLength(replies);
    expect(await registrations()).toHaveLength(1);
    const receipts = await stack.query<{ n: number }>("select count(*)::int as n from telegram_update_receipts where update_id = $1", [update.update_id]);
    expect(receipts[0]!.n).toBe(1);
  });

  it("answers a repeated button press without registering twice", async () => {
    const reply = await ask(LINKED, tgCallback(LINKED, `rg:${tournamentId}`));
    expect(reply.text).not.toContain("Registered!");
    expect(await registrations()).toHaveLength(1);
  });

  it("cancels through the bot", async () => {
    const reply = await ask(LINKED, tgCallback(LINKED, `cx:${tournamentId}`));
    expect(reply.text).toContain("Registration cancelled");
    expect((await registrations())[0]!.status).toBe("CANCELLED");
    await waitFor(() => stack.telegram.messagesTo(LINKED).find((m) => m.text.includes("Your registration for Friday Bounty was cancelled")), "cancellation notice", 10_000);
  });

  it("keeps state-changing staff commands disabled", async () => {
    for (const cmd of ["/finish", "/reset", "/refund"]) {
      const reply = await ask(LINKED, tgMessage(LINKED, cmd));
      expect(reply.text).toMatch(/disabled/);
    }
    const tournament = await td.get<{ status: string }>(`/api/v1/tournaments/${tournamentId}`);
    expect(tournament.status).toBe("REGISTRATION_OPEN");
  });

  it("reports the bot as online to the administrators", async () => {
    const integration = await td.get<{ status: string; tokenConfigured: boolean; botUsername: string }>("/api/v1/telegram/integration");
    expect(integration).toMatchObject({ status: "ONLINE", tokenConfigured: true, botUsername: stack.telegram.username });
    // The token itself is never returned.
    expect(JSON.stringify(integration)).not.toContain("AAE2e");
  });
});
