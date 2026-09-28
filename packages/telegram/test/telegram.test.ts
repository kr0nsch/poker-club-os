import { describe, expect, it, vi } from "vitest";
import { LongPoller, TelegramApiError, TelegramBotClient, signWebAppInitData, verifyWebAppInitData, verifyWebhookSecret, button } from "../src/index.js";

const TOKEN = "123456:ABCdefGhIJKlmnoPQRstuVWXyz0123456789";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("TelegramBotClient", () => {
  it("returns results and classifies errors with retry_after", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { id: 1, is_bot: true, first_name: "bot" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } }, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403));
    const client = new TelegramBotClient(TOKEN, { fetch: fetchMock as unknown as typeof fetch });
    expect((await client.getMe()).id).toBe(1);
    const rate = await client.sendMessage({ chat_id: 1, text: "x" }).catch((e: unknown) => e as TelegramApiError);
    expect(rate).toBeInstanceOf(TelegramApiError);
    expect((rate as TelegramApiError).kind).toBe("rate_limited");
    expect((rate as TelegramApiError).retryAfterSeconds).toBe(7);
    const blocked = (await client.sendMessage({ chat_id: 1, text: "x" }).catch((e: unknown) => e)) as TelegramApiError;
    expect(blocked.permanent).toBe(true);
  });

  it("reports network failures without leaking the token", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error(`connect ENETUNREACH https://api.telegram.org/bot${TOKEN}/sendMessage`));
    const client = new TelegramBotClient(TOKEN, { fetch: fetchMock as unknown as typeof fetch });
    const err = (await client.sendMessage({ chat_id: 1, text: "x" }).catch((e: unknown) => e)) as TelegramApiError;
    expect(err.networkDown).toBe(true);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain("<bot-token>");
  });

  it("rejects malformed tokens", () => {
    expect(() => new TelegramBotClient("not-a-token")).toThrow();
  });
});

describe("LongPoller", () => {
  it("processes updates in order, persists offsets and backs off on network errors", async () => {
    const handled: number[] = [];
    let offset: number | null = null;
    const statuses: string[] = [];
    let calls = 0;
    const client = {
      deleteWebhook: vi.fn().mockResolvedValue(true),
      getUpdates: vi.fn(async (off: number | undefined) => {
        calls++;
        if (calls === 1) throw new TelegramApiError("network", "ENETUNREACH");
        if (calls === 2) {
          expect(off).toBeUndefined();
          return [{ update_id: 11 }, { update_id: 10 }];
        }
        expect(off).toBe(12);
        poller.stop();
        return [];
      }),
    } as unknown as TelegramBotClient;
    const sleeps: number[] = [];
    const poller: LongPoller = new LongPoller({
      client,
      loadOffset: async () => offset,
      saveOffset: async (id) => {
        offset = id;
      },
      handle: async (u) => {
        handled.push(u.update_id);
      },
      onStatus: (s) => statuses.push(s),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    poller.start();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
    await poller.stop();
    expect(handled).toEqual([10, 11]);
    expect(offset).toBe(11);
    expect(statuses[0]).toBe("WAITING_FOR_NETWORK");
    expect(sleeps[0]).toBeGreaterThan(0);
  });
});

describe("Mini App initData and webhook secret", () => {
  it("accepts correctly signed initData and rejects tampering", () => {
    const now = Date.now();
    const initData = signWebAppInitData(
      { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 42, is_bot: false, first_name: "Ann" }), query_id: "q1" },
      TOKEN,
    );
    const v = verifyWebAppInitData(initData, TOKEN, 3600, now);
    expect(v.user.id).toBe(42);
    const tampered = initData.replace("Ann", "Bob");
    expect(() => verifyWebAppInitData(tampered, TOKEN, 3600, now)).toThrow(/signature/);
    expect(() => verifyWebAppInitData(initData, "999:OTHERtokenOTHERtokenOTHERtoken12345", 3600, now)).toThrow(/signature/);
    expect(() => verifyWebAppInitData(initData, TOKEN, 60, now + 3600_000)).toThrow(/too old/);
  });

  it("compares webhook secrets in constant time", () => {
    expect(verifyWebhookSecret("abc", "abc")).toBe(true);
    expect(verifyWebhookSecret("abd", "abc")).toBe(false);
    expect(verifyWebhookSecret(undefined, "abc")).toBe(false);
  });

  it("limits callback data to 64 bytes", () => {
    expect(() => button.callback("x", "a".repeat(65))).toThrow();
  });
});
