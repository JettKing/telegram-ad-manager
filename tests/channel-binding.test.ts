import { describe, expect, it } from "vitest";
import { deriveChannelPermissions, TelegramBotApiClient, verifyTelegramChannel } from "../apps/api/src/channels";

describe("Telegram channel verification", () => {
  it("maps channel administrator rights to publish, pin/edit, and delete capabilities", () => {
    const snapshot = deriveChannelPermissions({
      status: "administrator",
      user: { id: 99, is_bot: true, first_name: "Bot" },
      can_post_messages: true,
      can_edit_messages: true,
      can_delete_messages: false,
    }, "2026-11-17T00:00:00.000Z");
    expect(snapshot).toEqual({ canPost: true, canPin: true, canDelete: false, botStatus: "administrator", checkedAt: "2026-11-17T00:00:00.000Z" });
  });

  it("verifies the chat is a channel and preserves permission_error snapshots", async () => {
    const client = {
      async getMe() { return { id: 99, is_bot: true, first_name: "Bot" }; },
      async getChat() { return { id: -100123, type: "channel", title: "Test Channel", username: "test_channel" }; },
      async getChatMember() { return { status: "member", user: { id: 99, is_bot: true, first_name: "Bot" } }; },
    };
    const verified = await verifyTelegramChannel(client, "@test_channel", "2026-11-17T00:00:00.000Z");
    expect(verified.telegramChatId).toBe("-100123");
    expect(verified.permissions.botStatus).toBe("not_admin");
    expect(verified.permissions.canPost).toBe(false);
  });
});

describe("Telegram Bot API client", () => {
  it("uses Bot API methods without exposing the token in the request body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const method = String(input).split("/").pop();
      const result = method === "getMe" ? { id: 99, is_bot: true, first_name: "Bot" } : { id: -100123, type: "channel", title: "Test Channel" };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    };
    const client = new TelegramBotApiClient("123:SECRET", fetchMock, "https://telegram.test");
    await client.getMe();
    await client.getChat("@test_channel");
    expect(calls[0].url).toBe("https://telegram.test/bot123:SECRET/getMe");
    expect(String(calls[0].init?.body)).toBe("{}");
    expect(calls[1].init?.body).toContain("@test_channel");
  });
});
