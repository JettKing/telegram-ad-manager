import { describe, expect, it } from "vitest";
import { parseTelegramMediaUpdate, transitionMediaGroup } from "../apps/api/src/media";

const base = { update_id: 1, message: { message_id: 10, date: 1794873600, chat: { id: 123, type: "private" }, from: { id: 456 } } };

describe("Telegram media parser", () => {
  it("keeps the largest photo file_id and album metadata", () => {
    const parsed = parseTelegramMediaUpdate({ ...base, message: { ...base.message, media_group_id: "album-1", caption: "campaign", photo: [
      { file_id: "small", file_unique_id: "small-u", width: 100, height: 100 },
      { file_id: "large", file_unique_id: "large-u", width: 1000, height: 800, file_size: 12345 },
    ] } }, new Date("2026-11-17T00:00:00.000Z"));
    expect(parsed).toMatchObject({ mediaType: "photo", fileId: "large", fileUniqueId: "large-u", width: 1000, height: 800, fileSize: 12345, mediaGroupId: "album-1", caption: "campaign", sourceChatId: "123", fromTelegramUserId: "456" });
  });

  it("parses video, animation, document and plain text", () => {
    expect(parseTelegramMediaUpdate({ ...base, message: { ...base.message, video: { file_id: "v", file_unique_id: "vu", width: 640, height: 360, duration: 9 } } })?.mediaType).toBe("video");
    expect(parseTelegramMediaUpdate({ ...base, message: { ...base.message, animation: { file_id: "a", file_unique_id: "au", width: 320, height: 240, duration: 4, file_name: "x.gif", mime_type: "image/gif" } } })?.fileName).toBe("x.gif");
    expect(parseTelegramMediaUpdate({ ...base, message: { ...base.message, document: { file_id: "d", file_unique_id: "du", file_name: "brief.pdf", mime_type: "application/pdf", file_size: 88 } } })?.mediaType).toBe("document");
    expect(parseTelegramMediaUpdate({ ...base, message: { ...base.message, text: "hello" } })?.textContent).toBe("hello");
  });

  it("ignores unsupported updates", () => {
    expect(parseTelegramMediaUpdate({ update_id: 2, callback_query: { id: "callback" } })).toBeNull();
    expect(parseTelegramMediaUpdate({ update_id: 3, message: { message_id: 1, chat: { id: 1 } } })).toBeNull();
  });
});

describe("album aggregation state machine", () => {
  it("opens collecting, settles for confirmation, and completes", () => {
    expect(transitionMediaGroup("collecting", "item_received")).toEqual({ state: "collecting", incrementVersion: false });
    expect(transitionMediaGroup("collecting", "begin_settlement")).toEqual({ state: "settling", incrementVersion: false });
    expect(transitionMediaGroup("settling", "settle")).toEqual({ state: "pending_confirmation", incrementVersion: false });
    expect(transitionMediaGroup("pending_confirmation", "confirm")).toEqual({ state: "completed", incrementVersion: false });
  });

  it("reopens a completed group for a late item with a new version", () => {
    expect(transitionMediaGroup("completed", "item_received")).toEqual({ state: "collecting", incrementVersion: true });
    expect(transitionMediaGroup("pending_confirmation", "item_received")).toEqual({ state: "collecting", incrementVersion: false });
  });
});
