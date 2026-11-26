import type { D1Like } from "@tg-ad-manager/telegram";

export type MediaType = "text" | "photo" | "video" | "animation" | "document";
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
  receivedAt: string;
  sourceKind: "private" | "channel" | "other";
}

export function isExplicitMediaCommand(value: string | undefined): boolean { return typeof value === "string" && /^(?:\/ad|\/upload)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(value.trim()); }
export interface MediaScope {
  tenantId: string;
  workspaceId: string;
}

export interface MediaIngestResult {
  handled: boolean;
  reason: "stored" | "album_item_stored" | "unsupported_update" | "scope_not_found";
  assetId?: string;
  mediaGroupId?: string;
  groupState?: MediaGroupState;
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
  return photos.at(-1) ?? null;
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

  const photo = chooseLargestPhoto(message.photo);
  if (photo) return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType: "photo", mediaGroupId, caption, receivedAt, ...fileFields(photo) };
  for (const [key, mediaType] of [["video", "video"], ["animation", "animation"], ["document", "document"]] as const) {
    const media = record(message[key]);
    if (media) return { messageId, sourceChatId: chatId, fromTelegramUserId, sourceKind, mediaType, mediaGroupId, caption, receivedAt, ...fileFields(media) };
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

interface ScopeRow { tenantId: string; workspaceId: string }
interface GroupRow { id: string; tenant_id?: string; workspace_id?: string; state: MediaGroupState; version: number }
interface AssetRow { id: string; media_type: MediaType; file_id?: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number; width?: number; height?: number; duration_seconds?: number; text_content?: string; caption?: string; media_group_id?: string; created_at: string }

export class D1MediaRepository {
  constructor(private readonly db: D1Like) {}

  async resolveScope(botIdentityId: string, sourceChatId: string, fromTelegramUserId?: string): Promise<MediaScope | null> {
    if (fromTelegramUserId) {
      const userScope = await this.db.prepare(
        `SELECT tm.tenant_id AS tenantId, wm.workspace_id AS workspaceId
         FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
         JOIN workspace_members wm ON wm.user_id = u.id
         JOIN workspaces w ON w.id = wm.workspace_id AND w.tenant_id = tm.tenant_id AND w.status = 'active'
         WHERE u.telegram_user_id = ? AND u.is_active = 1 ORDER BY tm.created_at, wm.created_at LIMIT 1`,
      ).bind(fromTelegramUserId).first<ScopeRow>();
      if (userScope) return userScope;
    }
    const channelScope = await this.db.prepare(
      `SELECT tenant_id AS tenantId, workspace_id AS workspaceId FROM telegram_channels
       WHERE bot_identity_id = ? AND telegram_chat_id = ? AND status != 'unbound' LIMIT 1`,
    ).bind(botIdentityId, sourceChatId).first<ScopeRow>();
    return channelScope;
  }

  async upsertAsset(scope: MediaScope, botIdentityId: string, media: ParsedMediaMessage, now: string): Promise<string> {
    const candidateId = crypto.randomUUID();
    const existing = await this.db.prepare("SELECT id, tenant_id, workspace_id FROM media_assets WHERE bot_identity_id = ? AND source_chat_id = ? AND telegram_message_id = ? LIMIT 1").bind(botIdentityId, media.sourceChatId, media.messageId).first<{ id: string; tenant_id: string; workspace_id: string }>();
    if (existing && (existing.tenant_id !== scope.tenantId || existing.workspace_id !== scope.workspaceId)) throw new Error("MEDIA_ASSET_SCOPE_CONFLICT");
    await this.db.prepare(
      `INSERT INTO media_assets (id, tenant_id, workspace_id, bot_identity_id, media_type, file_id, file_unique_id, file_name, mime_type, file_size, width, height, duration_seconds, media_group_id, telegram_message_id, source_chat_id, text_content, caption, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
       ON CONFLICT (bot_identity_id, source_chat_id, telegram_message_id) DO UPDATE SET file_id = excluded.file_id, file_unique_id = excluded.file_unique_id, file_name = excluded.file_name, mime_type = excluded.mime_type, file_size = excluded.file_size, width = excluded.width, height = excluded.height, duration_seconds = excluded.duration_seconds, media_group_id = excluded.media_group_id, text_content = excluded.text_content, caption = excluded.caption, status = 'ready', updated_at = excluded.updated_at`,
    ).bind(candidateId, scope.tenantId, scope.workspaceId, botIdentityId, media.mediaType, media.fileId ?? null, media.fileUniqueId ?? null, media.fileName ?? null, media.mimeType ?? null, media.fileSize ?? null, media.width ?? null, media.height ?? null, media.durationSeconds ?? null, media.mediaGroupId ?? null, media.messageId, media.sourceChatId, media.textContent ?? null, media.caption ?? null, now, now).run();
    const stored = await this.db.prepare("SELECT id FROM media_assets WHERE bot_identity_id = ? AND source_chat_id = ? AND telegram_message_id = ? LIMIT 1").bind(botIdentityId, media.sourceChatId, media.messageId).first<{ id: string }>();
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
    } else {
      const transition = transitionMediaGroup(group.state, "item_received");
      const version = group.version + (transition.incrementVersion ? 1 : 0);
      await this.db.prepare("UPDATE media_groups SET state = ?, version = ?, last_received_at = ? WHERE id = ?").bind(transition.state, version, receivedAt, group.id).run();
      group = { ...group, state: transition.state, version };
    }
    await this.db.prepare("INSERT OR IGNORE INTO media_group_items (media_group_id, media_asset_id, message_id, received_at) VALUES (?, ?, ?, ?)").bind(group.id, assetId, messageId, receivedAt).run();
    return { groupId: group.id, state: group.state };
  }

  async ingest(botIdentityId: string, update: unknown, now = new Date().toISOString()): Promise<MediaIngestResult> {
    const media = parseTelegramMediaUpdate(update, new Date(now));
    if (!media) return { handled: false, reason: "unsupported_update" };
    if (media.sourceKind !== "private" && !isExplicitMediaCommand(media.caption ?? media.textContent)) {
      if (!media.mediaGroupId) return { handled: false, reason: "unsupported_update" };
      const authorizedGroup = await this.db.prepare("SELECT id FROM media_groups WHERE bot_identity_id = ? AND telegram_media_group_id = ? LIMIT 1").bind(botIdentityId, media.mediaGroupId).first<{ id: string }>();
      if (!authorizedGroup) return { handled: false, reason: "unsupported_update" };
    }
    const scope = await this.resolveScope(botIdentityId, media.sourceChatId, media.fromTelegramUserId);
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
