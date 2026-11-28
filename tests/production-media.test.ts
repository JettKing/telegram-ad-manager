import { describe, expect, it } from "vitest";
import { D1MediaRepository, parseTelegramMediaUpdate } from "../apps/api/src/media";
import { ProductionMediaRepository } from "../apps/api/src/production-media";

const base = {
  update_id: 29,
  message: {
    message_id: 72,
    date: 1794873600,
    chat: { id: 123456, type: "private" },
    from: { id: 98765 },
  },
};

function dbForScope(scopeCount: number, queries: string[] = []) {
  return {
    prepare(query: string) {
      queries.push(query);
      return {
        bind() {
          return {
            async first<T>() {
              if (query.includes("FROM users u JOIN")) {
                return (scopeCount === 1
                  ? { tenantId: "tenant-1", workspaceId: "workspace-1", scopeCount }
                  : { tenantId: null, workspaceId: null, scopeCount }) as T;
              }
              if (query.includes("FROM (SELECT DISTINCT tenant_id, workspace_id FROM telegram_channels")) {
                return { tenantId: null, workspaceId: null, scopeCount: 0 } as T;
              }
              return null;
            },
            async all<T>() { return { results: [] as T[] }; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  } as never;
}

describe("production media ownership and safety", () => {
  it("rejects ambiguous user membership without falling back to an arbitrary workspace", async () => {
    const queries: string[] = [];
    const repository = new ProductionMediaRepository(dbForScope(2, queries));
    const update = { ...base, message: { ...base.message, photo: [{ file_id: "private-photo" }] } };

    await expect(repository.ingest("bot-1", update)).resolves.toEqual({ handled: false, reason: "scope_ambiguous" });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("COUNT(*) AS scopeCount");
    expect(queries[0]).not.toContain("ORDER BY tm.created_at");
    expect(queries.some((query) => query.includes("INSERT INTO creative_media"))).toBe(false);
  });

  it("also fails closed for ambiguous memberships in the legacy media adapter", async () => {
    const queries: string[] = [];
    const repository = new D1MediaRepository(dbForScope(2, queries));
    const update = { ...base, message: { ...base.message, photo: [{ file_id: "private-photo" }] } };

    await expect(repository.ingest("bot-1", update)).resolves.toEqual({ handled: false, reason: "scope_ambiguous" });
    expect(queries).toHaveLength(1);
    expect(queries.some((query) => query.includes("INSERT INTO media_assets"))).toBe(false);
  });

  it.each(["audio", "voice", "video_note", "sticker", "paid_media"] as const)("identifies unsupported Telegram %s media and refuses ingestion", async (kind) => {
    const mediaValue = kind === "paid_media" ? { type: "video", media: [] } : { file_id: `${kind}-id`, file_unique_id: `${kind}-unique` };
    const update = { ...base, message: { ...base.message, media_group_id: "album-unsupported", [kind]: mediaValue } };
    const parsed = parseTelegramMediaUpdate(update);
    expect(parsed).toMatchObject({ mediaType: "unsupported", unsupportedMediaType: kind, mediaGroupId: "album-unsupported" });

    const repository = new ProductionMediaRepository({ prepare() { throw new Error("unsupported media must not touch storage"); } } as never);
    await expect(repository.ingest("bot-1", update)).resolves.toMatchObject({
      handled: false,
      reason: "unsupported_media",
      mediaType: "unsupported",
      unsupportedMediaType: kind,
      telegramMediaGroupId: "album-unsupported",
    });
  });

  it.each([
    { label: "photo array without a valid item", message: { photo: [] } },
    { label: "photo without file_id", message: { photo: [{ width: 400, height: 300 }] } },
    { label: "video without file_id", message: { video: { duration: 4 } } },
  ])("preserves the recognized type but rejects $label", async ({ message }) => {
    const update = { ...base, message: { ...base.message, media_group_id: "album-incomplete", ...message } };
    const parsed = parseTelegramMediaUpdate(update);
    expect(parsed).toMatchObject({ incomplete: true, mediaGroupId: "album-incomplete" });

    const repository = new ProductionMediaRepository({ prepare() { throw new Error("incomplete media must not touch storage"); } } as never);
    await expect(repository.ingest("bot-1", update)).resolves.toMatchObject({
      handled: false,
      reason: "incomplete_media",
      mediaType: parsed?.mediaType,
      telegramMediaGroupId: "album-incomplete",
    });
  });

  it("continues ingesting complete supported media with a unique Telegram-user workspace", async () => {
    const queries: string[] = [];
    const db = {
      prepare(query: string) {
        queries.push(query);
        return {
          bind() {
            return {
              async first<T>() {
                if (query.includes("FROM users u JOIN")) return { tenantId: "tenant-1", workspaceId: "workspace-1", scopeCount: 1 } as T;
                if (query.includes("FROM creative_media") && query.includes("tenant_id, workspace_id")) return null;
                if (query.includes("SELECT id FROM creative_media WHERE bot_identity_id")) return { id: "asset-1" } as T;
                return null;
              },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
    } as never;
    const repository = new ProductionMediaRepository(db);
    const update = { ...base, message: { ...base.message, photo: [{ file_id: "photo-ok", file_unique_id: "photo-unique", width: 800, height: 600 }] } };

    await expect(repository.ingest("bot-1", update, "2026-11-17T00:00:00.000Z")).resolves.toMatchObject({ handled: true, reason: "stored", assetId: "asset-1" });
    expect(queries.some((query) => query.includes("INSERT INTO creative_media"))).toBe(true);
  });

  it("keeps workspace-scoped historical production asset reads intact", async () => {
    let query = "";
    const db = {
      prepare(sql: string) {
        query = sql;
        return { bind() { return { async all<T>() { return { results: [{ id: "legacy-asset", media_type: "document" }] as T[] }; } }; } };
      },
    } as never;
    const repository = new ProductionMediaRepository(db);

    await expect(repository.listAssets("tenant-1", "workspace-1")).resolves.toEqual([{ id: "legacy-asset", media_type: "document" }]);
    expect(query).toContain("FROM creative_media WHERE tenant_id = ? AND workspace_id = ?");
    expect(query).toContain("ORDER BY created_at DESC LIMIT 100");
  });
});
