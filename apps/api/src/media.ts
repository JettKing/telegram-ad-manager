import type { D1Like } from "@tg-ad-manager/telegram";

export type MediaType = "text" | "photo" | "video" | "animation" | "document" | "unsupported";
export type MediaGroupState = "collecting" | "settling" | "pending_confirmation" | "completed" | "failed";

type TelegramMessage = {
  message_id?: unknown;
  date?: unknown;
  chat?: { id?: unknown; type?: unknown };
  from?: { id?: unknown };
  text?: unknown;
  caption?: unknown;
  media_group_id?: unknown;
  photo?: unknown;
  video?: unknown;
  animation?: unknown;
  document?: unknown;
};

export interface ParsedMediaMessage {
  messageId: number;
  sourceChatId: string;
  fromTelegramUserId?: string;
  mediaType: MediaType;
  mediaGroupId?: string;
  textContent?: string;
  caption?: string;
  fileId?: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  unsupportedMediaType?: string;
  incomplete?: boolean;
  receivedAt: string;
  sourceKind: "private" | "channel" | "other";
}

export interface MediaScope {
  tenantId: string;
  workspaceId: string;
}

export interface MediaIngestResult {
  handled: boolean;
  reason: "stored" | "album_item_stored" | "unsupported_update" | "unsupported_media" | "incomplete_media" | "scope_not_found" | "scope_ambiguous";
  assetId?: string;
  mediaGroupId?: string;
  groupState?: MediaGroupState;
  mediaType?: MediaType;
  unsupportedMediaType?: string;
  telegramMediaGroupId?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeInt(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function chooseLargestPhoto(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const photos = value.map(record).filter((item): item is Record<string, unknown> => Boolean(item));
  return photos.sort((left, right) => {
    const leftSize = safeInt(left.file_size) ?? (safeInt(left.width) ?? 0) * (safeInt(left.height) ?? 0);
    const rightSize = safeInt(right.file_size) ?? (safeInt(right.width) ?? 0) * (safeInt(right.height) ?? 0);
    return leftSize - rightSize;
  }).at(-1) ?? null;
}

function fileFields(value: Record<string, unknown>): Pick<ParsedMediaMessage, "fileId" | "fileUniqueId" | "fileName" | "mimeType" | "fileSize" | "width" | "height" | "durationSeconds"> {
  return {
    fileId: safeString(value.file_id),
    fileUniqueId: safeString(value.file_unique_id),
    fileName: safeString(value.file_name),
    mimeType: safeString(value.mime_type),
    fileSize: safeInt(value.file_size),
    width: safeInt(value.width),
    height: safeInt(value.height),
    durationSeconds: safeInt(value.duration),
  };
}

export function parseTelegramMediaUpdate(value: unknown, now = new Date()): ParsedMediaMessage | null {
  const update = record(value);
  if (!update) return null;
  const channelMessage = record(update.channel_post) ?? record(update.edited_channel_post);
  const message = record(update.message) ?? channelMessage ?? record(update.edited_message);
  if (!message) return null;
  const messageId = safeInt(message.message_id);
  const chat = record(message.chat);
  const chatId = chat ? safeString(chat.id) ?? (typeof chat.id === "number" ? String(chat.id) : undefined) : undefined;
  if (!messageId || !chatId) return null;
  const from = record(message.from);
  const fromTelegramUserId = from ? safeString(from.id) ?? (typeof from.id === "number" ? String(from.id) : undefined) : undefined;
  const sourceKind = channelMessage ? "channel" : chat?.type === "private" ? "private" : "other";
  const mediaGroupId = safeString(message.media_group_id);
  const caption = safeString(message.caption);
  const text = safeString(message.text);
  const receivedAt = typeof message.date === "number" && Number.isFinite(message.date) ? new Date(message.date * 1000).toISOString() : now.toISOString();

  if (Object.prototype.hasOwnProperty.call(message, "photo")) {
    const photo = chooseLargestPhoto(message.photo);
    if (!photo) return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType: "photo", mediaGroupId, caption, incomplete: true, receivedAt };
    const fields = fileFields(photo);
    return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType: "photo", mediaGroupId, caption, incomplete: !fields.fileId, receivedAt, ...fields };
  }
  for (const [key, mediaType] of [["video", "video"], ["animation", "animation"], ["document", "document"]] as const) {
    if (!Object.prototype.hasOwnProperty.call(message, key)) continue;
    const media = record(message[key]);
    if (!media) return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType, mediaGroupId, caption, incomplete: true, receivedAt };
    const fields = fileFields(media);
    return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType, mediaGroupId, caption, incomplete: !fields.fileId, receivedAt, ...fields };
  }
  for (const key of ["audio", "voice", "video_note", "sticker", "paid_media"] as const) {
    if (!Object.prototype.hasOwnProperty.call(message, key)) continue;
    const raw = record(message[key]);
    const fields = raw ? fileFields(raw) : {};
    return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType: "unsupported", unsupportedMediaType: key, mediaGroupId, caption, receivedAt, ...fields };
  }
  if (text) return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType: "text", textContent: text, caption, receivedAt };
  return null;
}

export function transitionMediaGroup(state: MediaGroupState, event: "item_received" | "begin_settlement" | "settle" | "confirm" | "fail"): { state: MediaGroupState; incrementVersion: boolean } {
  if (event === "fail") return { state: "failed", incrementVersion: false };
  if (event === "item_received") return { state: "collecting", incrementVersion: state === "completed" };
  if (event === "begin_settlement") return { state: state === "collecting" ? "settling" : state, incrementVersion: false };
  if (event === "settle") return { state: state === "settling" ? "pending_confirmation" : state, incrementVersion: false };
  return { state: state === "pending_confirmation" ? "completed" : state, incrementVersion: false };
}

export interface MediaScopeResolution {
  scope: MediaScope | null;
  ambiguous: boolean;
}

interface ScopeCountRow extends MediaScope {
  scopeCount?: number | string;
}

function scopedResolution(row: ScopeCountRow | null): MediaScopeResolution {
  if (!row) return { scope: null, ambiguous: false };
  const count = row.scopeCount === undefined ? (row.tenantId && row.workspaceId ? 1 : 0) : Number(row.scopeCount);
  if (count > 1) return { scope: null, ambiguous: true };
  if (count !== 1 || !row.tenantId || !row.workspaceId) return { scope: null, ambiguous: false };
  return { scope: { tenantId: row.tenantId, workspaceId: row.workspaceId }, ambiguous: false };
}

/** Resolve a workspace only when Telegram identity or an active chat binding selects exactly one scope. */
export async function resolveTelegramMediaScope(db: D1Like, botIdentityId: string, sourceChatId: string, fromTelegramUserId?: string): Promise<MediaScopeResolution> {
  if (fromTelegramUserId) {
    const userRow = await db.prepare(`SELECT CASE WHEN COUNT(*) = 1 THEN MIN(tenant_id) END AS tenantId,
        CASE WHEN COUNT(*) = 1 THEN MIN(workspace_id) END AS workspaceId, COUNT(*) AS scopeCount
      FROM (SELECT DISTINCT tm.tenant_id, wm.workspace_id
        FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
        JOIN workspace_members wm ON wm.user_id = u.id AND wm.tenant_id = tm.tenant_id
        JOIN workspaces w ON w.id = wm.workspace_id AND w.tenant_id = tm.tenant_id AND w.status = 'active'
        JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
        WHERE u.telegram_user_id = ? AND u.is_active = 1) AS user_scopes`).bind(fromTelegramUserId).first<ScopeCountRow>();
    const userResolution = scopedResolution(userRow);
    if (userResolution.ambiguous || userResolution.scope) return userResolution;
  }
  const channelRow = await db.prepare(`SELECT CASE WHEN COUNT(*) = 1 THEN MIN(tenant_id) END AS tenantId,
      CASE WHEN COUNT(*) = 1 THEN MIN(workspace_id) END AS workspaceId, COUNT(*) AS scopeCount
    FROM (SELECT DISTINCT c.tenant_id, c.workspace_id FROM telegram_channels c
      JOIN workspaces w ON w.id = c.workspace_id AND w.tenant_id = c.tenant_id AND w.status = 'active'
      JOIN tenants t ON t.id = c.tenant_id AND t.status = 'active'
      WHERE c.bot_identity_id = ? AND c.telegram_chat_id = ? AND c.status = 'active') AS channel_scopes`).bind(botIdentityId, sourceChatId).first<ScopeCountRow>();
  return scopedResolution(channelRow);
}

function failedMediaIngest(media: ParsedMediaMessage): MediaIngestResult | null {
  if (media.mediaType === "unsupported") return { handled: false, reason: "unsupported_media", mediaType: media.mediaType, unsupportedMediaType: media.unsupportedMediaType, telegramMediaGroupId: media.mediaGroupId };
  if (media.mediaType !== "text" && (media.incomplete || !media.fileId)) return { handled: false, reason: "incomplete_media", mediaType: media.mediaType, telegramMediaGroupId: media.mediaGroupId };
  return null;
}

interface ScopeRow { tenantId: string; workspaceId: string }
interface GroupRow { id: string; tenant_id?: string; workspace_id?: string; state: MediaGroupState; version: number }
interface AssetRow { id: string; media_type: MediaType; file_id?: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number; width?: number; height?: number; duration_seconds?: number; text_content?: string; caption?: string; media_group_id?: string; created_at: string }

export class D1MediaRepository {
  constructor(private readonly db: D1Like) {}

  async resolveScope(botIdentityId: string, sourceChatId: string, fromTelegramUserId?: string): Promise<MediaScope | null> {
    return (await resolveTelegramMediaScope(this.db, botIdentityId, sourceChatId, fromTelegramUserId)).scope;
  }

  async upsertAsset(scope: MediaScope, botIdentityId: string, media: ParsedMediaMessage, now: string): Promise<string> {
    if (failedMediaIngest(media)) throw new Error("MEDIA_ASSET_UNSUPPORTED_OR_INCOMPLETE");
    const candidateId = crypto.randomUUID();
    const existing = await this.db.prepare("SELECT id, tenant_id, workspace_id FROM media_assets WHERE bot_identity_id = ? AND source_chat_id = ? AND telegram_message_id = ? LIMIT 1").bind(botIdentityId, media.sourceChatId, media.messageId).first<{ id: string; tenant_id: string; workspace_id: string }>();
    if (existing && (existing.tenant_id !== scope.tenantId || existing.workspace_id !== scope.workspaceId)) throw new Error("MEDIA_ASSET_SCOPE_CONFLICT");
    await this.db.prepare(
      `INSERT INTO media_assets (id, tenant_id, workspace_id, bot_identity_id, media_type, file_id, file_unique_id, file_name, mime_type, file_size, width, height, duration_seconds, media_group_id, telegram_message_id, source_chat_id, text_content, caption, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
       ON CONFLICT (bot_identity_id, source_chat_id, telegram_message_id) DO UPDATE SET file_id = excluded.file_id, file_unique_id = excluded.file_unique_id, file_name = excluded.file_name, mime_type = excluded.mime_type, file_size = excluded.file_size, width = excluded.width, height = excluded.height, duration_seconds = excluded.duration_seconds, media_group_id = excluded.media_group_id, text_content = excluded.text_content, caption = excluded.caption, status = 'ready', updated_at = excluded.updated_at
       WHERE media_assets.tenant_id = excluded.tenant_id AND media_assets.workspace_id = excluded.workspace_id`,
    ).bind(candidateId, scope.tenantId, scope.workspaceId, botIdentityId, media.mediaType, media.fileId ?? null, media.fileUniqueId ?? null, media.fileName ?? null, media.mimeType ?? null, media.fileSize ?? null, media.width ?? null, media.height ?? null, media.durationSeconds ?? null, media.mediaGroupId ?? null, media.messageId, media.sourceChatId, media.textContent ?? null, media.caption ?? null, now, now).run();
    const stored = await this.db.prepare("SELECT id FROM media_assets WHERE bot_identity_id = ? AND source_chat_id = ? AND telegram_message_id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1").bind(botIdentityId, media.sourceChatId, media.messageId, scope.tenantId, scope.workspaceId).first<{ id: string }>();
    if (!stored) throw new Error("MEDIA_ASSET_UPSERT_FAILED");
    return stored.id;
  }

  async upsertGroup(scope: MediaScope, botIdentityId: string, groupId: string, assetId: string, messageId: number, receivedAt: string, now: string): Promise<{ groupId: string; state: MediaGroupState }> {
    let group = await this.db.prepare("SELECT id, tenant_id, workspace_id, state, version FROM media_groups WHERE bot_identity_id = ? AND telegram_media_group_id = ? LIMIT 1").bind(botIdentityId, groupId).first<GroupRow>();
    if (group && (group.tenant_id !== scope.tenantId || group.workspace_id !== scope.workspaceId)) throw new Error("MEDIA_GROUP_SCOPE_CONFLICT");
    if (!group) {
      group = { id: crypto.randomUUID(), state: "collecting", version: 1 };
      await this.db.prepare(
        `INSERT INTO media_groups (id, tenant_id, workspace_id, bot_identity_id, telegram_media_group_id, state, version, last_received_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'collecting', 1, ?, ?)`,
      ).bind(group.id, scope.tenantId, scope.workspaceId, botIdentityId, groupId, receivedAt, now).run();
      await this.db.prepare("INSERT OR IGNORE INTO media_group_items (media_group_id, media_asset_id, message_id, received_at) VALUES (?, ?, ?, ?)").bind(group.id, assetId, messageId, receivedAt).run();
    } else {
      const inserted = await this.db.prepare("INSERT OR IGNORE INTO media_group_items (media_group_id, media_asset_id, message_id, received_at) VALUES (?, ?, ?, ?)").bind(group.id, assetId, messageId, receivedAt).run();
      if ((inserted.meta?.changes ?? 0) === 0) return { groupId: group.id, state: group.state };
      const transition = transitionMediaGroup(group.state, "item_received");
      const version = group.version + (transition.incrementVersion ? 1 : 0);
      await this.db.prepare("UPDATE media_groups SET state = ?, version = ?, last_received_at = ? WHERE id = ?").bind(transition.state, version, receivedAt, group.id).run();
      group = { ...group, state: transition.state, version };
    }
    return { groupId: group.id, state: group.state };
  }

  async ingest(botIdentityId: string, update: unknown, now = new Date().toISOString()): Promise<MediaIngestResult> {
    const media = parseTelegramMediaUpdate(update, new Date(now));
    if (!media) return { handled: false, reason: "unsupported_update" };
    if (media.sourceKind !== "private") return { handled: false, reason: "unsupported_update" };
    const mediaFailure = failedMediaIngest(media);
    if (mediaFailure) return mediaFailure;
    const resolution = await resolveTelegramMediaScope(this.db, botIdentityId, media.sourceChatId, media.fromTelegramUserId);
    if (resolution.ambiguous) return { handled: false, reason: "scope_ambiguous" };
    const scope = resolution.scope;
    if (!scope) return { handled: false, reason: "scope_not_found" };
    const assetId = await this.upsertAsset(scope, botIdentityId, media, now);
    if (!media.mediaGroupId) return { handled: true, reason: "stored", assetId };
    const group = await this.upsertGroup(scope, botIdentityId, media.mediaGroupId, assetId, media.messageId, media.receivedAt, now);
    return { handled: true, reason: "album_item_stored", assetId, mediaGroupId: group.groupId, groupState: group.state };
  }

  async listAssets(tenantId: string, workspaceId: string): Promise<AssetRow[]> {
    const prepared = this.db.prepare(
      `SELECT id, media_type, file_id, file_unique_id, file_name, mime_type, file_size, width, height, duration_seconds, text_content, caption, media_group_id, created_at
       FROM media_assets WHERE tenant_id = ? AND workspace_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 100`,
    ).bind(tenantId, workspaceId);
    if (!prepared.all) return [];
    return (await prepared.all<AssetRow>()).results;
  }

  async startSettlement(groupId: string, tenantId: string, workspaceId: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE media_groups SET state = 'settling' WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND state = 'collecting'").bind(groupId, tenantId, workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async markPendingConfirmation(groupId: string, tenantId: string, workspaceId: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE media_groups SET state = 'pending_confirmation' WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND state = 'settling'").bind(groupId, tenantId, workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async confirmGroup(groupId: string, tenantId: string, workspaceId: string, completedAt: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE media_groups SET state = 'completed', completed_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND state = 'pending_confirmation'").bind(completedAt, groupId, tenantId, workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}
