import { describe, expect, it, vi } from "vitest";
import { TelegramApiError, TelegramBotApiClient } from "../apps/api/src/channels";
import { classifyPublishError, parseScheduleInput, retryDelaySeconds, TelegramPublisher } from "../apps/api/src/publishing";

describe("schedule and publish policy", () => {
  it("validates future schedule windows and end time", () => {
    const now = new Date("2026-11-17T00:00:00.000Z");
    expect(parseScheduleInput({ scheduleType: "once", plannedAt: "2026-11-17T01:00:00Z", plannedEndAt: "2026-11-17T02:00:00Z" }, now)).toMatchObject({ scheduleType: "once", plannedAt: "2026-11-17T01:00:00.000Z" });
    expect(() => parseScheduleInput({ scheduleType: "daily", plannedAt: "2026-11-16T23:00:00Z" }, now)).toThrow("未过期");
    expect(() => parseScheduleInput({ scheduleType: "once", plannedAt: "2026-11-17T01:00:00Z", plannedEndAt: "2026-11-17T00:30:00Z" }, now)).toThrow("晚于");
  });

  it("uses bounded exponential backoff and Telegram retry_after", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(4)).toBe(240);
    expect(retryDelaySeconds(2, 5)).toBe(5);
    expect(retryDelaySeconds(10, 10000)).toBe(3600);
  });

  it("classifies rate limit as retryable and permanent API errors as non-retryable", () => {
    const rateLimit = classifyPublishError(new TelegramApiError("sendMessage", 429, "Too Many Requests", 17));
    expect(rateLimit).toMatchObject({ code: "TELEGRAM_RATE_LIMIT", retryable: true, retryAfterSeconds: 17 });
    const badRequest = classifyPublishError(new TelegramApiError("sendMessage", 400, "Bad Request"));
    expect(badRequest).toMatchObject({ code: "TELEGRAM_API_ERROR", retryable: false });
  });
});

describe("Telegram publisher", () => {
  it("sends a photo with text as caption and falls back to text", async () => {
    const client = { sendPhoto: vi.fn().mockResolvedValue({ message_id: 11 }), sendMessage: vi.fn().mockResolvedValue({ message_id: 12 }) } as unknown as TelegramBotApiClient;
    const publisher = new TelegramPublisher(client);
    await expect(publisher.publish("-100", { text: "广告文案", assetIds: ["asset-1"], entities: [] }, [{ id: "asset-1", media_type: "photo", file_id: "file-1", sort_order: 0 }])).resolves.toBe(11);
    expect(client.sendPhoto).toHaveBeenCalledWith("-100", "file-1", "广告文案");

    const textOnlyClient = { sendMessage: vi.fn().mockResolvedValue({ message_id: 12 }) } as unknown as TelegramBotApiClient;
    await expect(new TelegramPublisher(textOnlyClient).publish("-100", { text: "纯文本", assetIds: [], entities: [] }, [])).resolves.toBe(12);
  });

  it("resumes by stable asset ID and rejects changed progress sources", async () => {
    const client = { sendPhoto: vi.fn().mockResolvedValue({ message_id: 22 }) } as unknown as TelegramBotApiClient;
    const publisher = new TelegramPublisher(client);
    const content = { text: "文案", assetIds: [], entities: [] };
    const assets = [
      { id: "asset-a", media_type: "photo" as const, file_id: "file-a", sort_order: 0 },
      { id: "asset-b", media_type: "photo" as const, file_id: "file-b", sort_order: 1 },
    ];
    const onMessage = vi.fn().mockResolvedValue(undefined);
    await expect(publisher.publishMany("-100", content, assets, onMessage, [{ messageId: 21, contentKey: "asset-a" }])).resolves.toEqual([21, 22]);
    expect(client.sendPhoto).toHaveBeenCalledTimes(1);
    expect(client.sendPhoto).toHaveBeenCalledWith("-100", "file-b", "文案");
    expect(onMessage).toHaveBeenCalledWith(22, "asset-b");
    await expect(publisher.publishMany("-100", content, assets, undefined, [{ messageId: 21, contentKey: "removed-asset" }])).rejects.toThrow("素材与已发送进度不匹配");
  });
});
