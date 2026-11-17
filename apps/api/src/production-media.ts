import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";
import { parseTelegramMediaUpdate, transitionMediaGroup, type MediaGroupState, type MediaIngestResult, type ParsedMediaMessage } from "./media.js";

interface AssetRow { id: string; media_type: "photo" | "video" | "animation" | "document"; file_id?: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number; width?: number; height?: number; duration_seconds?: number; caption?: string; media_group_id?: string; created_at: string }
interface ScopeRow { tenantId: string; workspaceId: string }
interface GroupRow { id: string; tenant_id: string; workspace_id: string; state: MediaGroupState; version: number }

function supportedMedia(media: ParsedMediaMessage): media is ParsedMediaMessage & { fileId: string } {
  return media.mediaType !== "text" && typeof media.fileId === "string" && media.fileId.length > 0;
}

export class ProductionMediaRepository {
  constructor(private readonly db: D1Like) {}

  async listAssets(tenantId: string, workspaceId: string): Promise<AssetRow[]> {
    const prepared = this.db.prepare(`SELECT id, media_type, file_id, file_unique_id, file_name, mime_type, file_size, width, height, duration_seconds, caption, media_group_id, created_at FROM creative_media WHERE tenant_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 100`).bind(tenantId, workspaceId);
    return prepared.all ? (await prepared.all<AssetRow>()).results : [];
  }

  private async resolveScope(botIdentityId: string, sourceChatId: string, fromTelegramUserId?: string): Promise<ScopeRow | null> {
    if (fromTelegramUserId) {
      const userScope = await this.db.prepare(`SELECT tm.tenant_id AS tenantId, wm.workspace_id AS workspaceId
        FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
        JOIN workspace_members wm ON wm.user_id = u.id AND wm.tenant_id = tm.tenant_id
        JOIN workspaces w ON w.id = wm.workspace_id AND w.tenant_id = tm.tenant_id AND w.status = 'active'
        WHERE u.telegram_user_id = ? AND u.is_active = 1 ORDER BY tm.created_at, wm.created_at LIMIT 1`).bind(fromTelegramUserId).first<ScopeRow>();
      if (userScope) return userScope;
    }
    return this.db.prepare(`SELECT tenant_id AS tenantId, workspace_id AS workspaceId FROM telegram_channels
      WHERE bot_identity_id = ? AND telegram_chat_id = ? AND status != 'unbound' LIMIT 1`).bind(botIdentityId, sourceChatId).first<ScopeRow>();
  }

  private async upsertAsset(scope: ScopeRow, botIdentityId: string, media: ParsedMediaMessage, now: string): Promise<string> {
    if (!supportedMedia(media)) throw new BusinessValidationError("MEDIA_UNSUPPORTED", "生产媒体入库目前只接受带 file_id 的 Telegram 媒体消息");
    const existing = await this.db.prepare("SELECT id, tenant_id, workspace_id FROM creative_media WHERE bot_identity_id = ? AND source_chat_id = ? AND telegram_message_id = ? LIMIT 1").bind(botIdentityId, media.sourceChatId, media.messageId).first<{ id: string; tenant_id: string; workspace_id: string }>();
    if (existing && (existing.tenant_id !== scope.tenantId || existing.workspace_id !== scope.workspaceId)) throw new BusinessValidationError("MEDIA_ASSET_SCOPE_CONFLICT", "Telegram 媒体已归属于其他工作空间");
    const candidateId = existing?.id ?? crypto.randomUUID();
    await this.db.prepare(`INSERT OR IGNORE INTO ad_creatives (id, tenant_id, workspace_id, name, title, content_text, content_format, media_type, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', 'plain', ?, 'draft', 1, ?, ?)`).bind(candidateId, scope.tenantId, scope.workspaceId, `Telegram media ${media.messageId}`, media.caption ?? null, media.mediaType, now, now).run();
    await this.db.prepare(`INSERT INTO creative_media (id, tenant_id, workspace_id, creative_id, bot_identity_id, media_type, file_id, file_unique_id, file_name, mime_type, file_size, width, height, duration_seconds, media_group_id, caption, sort_order, telegram_message_id, source_chat_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT (bot_identity_id, source_chat_id, telegram_message_id) DO UPDATE SET file_id = excluded.file_id, file_unique_id = excluded.file_unique_id, file_name = excluded.file_name, mime_type = excluded.mime_type, file_size = excluded.file_size, width = excluded.width, height = excluded.height, duration_seconds = excluded.duration_seconds, media_group_id = excluded.media_group_id, caption = excluded.caption, updated_at = excluded.updated_at`).bind(candidateId, scope.tenantId, scope.workspaceId, candidateId, botIdentityId, media.mediaType, media.fileId, media.fileUniqueId ?? null, media.fileName ?? null, media.mimeType ?? null, media.fileSize ?? null, media.width ?? null, media.height ?? null, media.durationSeconds ?? null, media.mediaGroupId ?? null, media.caption ?? null, media.messageId, media.sourceChatId, now, now).run();
    const stored = await this.db.prepare("SELECT id FROM creative_media WHERE bot_identity_id = ? AND source_chat_id = ? AND telegram_message_id = ? LIMIT 1").bind(botIdentityId, media.sourceChatId, media.messageId).first<{ id: string }>();
    if (!stored) throw new Error("MEDIA_ASSET_UPSERT_FAILED");
    return stored.id;
  }

  private async upsertGroup(scope: ScopeRow, botIdentityId: string, groupId: string, assetId: string, messageId: number, receivedAt: string, now: string): Promise<{ groupId: string; state: MediaGroupState }> {
    let group = await this.db.prepare("SELECT id, tenant_id, workspace_id, state, version FROM media_groups WHERE bot_identity_id = ? AND telegram_media_group_id = ? LIMIT 1").bind(botIdentityId, groupId).first<GroupRow>();
    if (group && (group.tenant_id !== scope.tenantId || group.workspace_id !== scope.workspaceId)) throw new BusinessValidationError("MEDIA_GROUP_SCOPE_CONFLICT", "Telegram 相册已归属于其他工作空间");
    if (!group) {
      group = { id: crypto.randomUUID(), tenant_id: scope.tenantId, workspace_id: scope.workspaceId, state: "collecting", version: 1 };
      await this.db.prepare(`INSERT INTO media_groups (id, tenant_id, workspace_id, bot_identity_id, telegram_media_group_id, state, version, last_received_at, created_at) VALUES (?, ?, ?, ?, ?, 'collecting', 1, ?, ?)`).bind(group.id, scope.tenantId, scope.workspaceId, botIdentityId, groupId, receivedAt, now).run();
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
    if (media.mediaType === "text") return { handled: false, reason: "unsupported_update" };
    const scope = await this.resolveScope(botIdentityId, media.sourceChatId, media.fromTelegramUserId);
    if (!scope) return { handled: false, reason: "scope_not_found" };
    const assetId = await this.upsertAsset(scope, botIdentityId, media, now);
    if (!media.mediaGroupId) return { handled: true, reason: "stored", assetId };
    const group = await this.upsertGroup(scope, botIdentityId, media.mediaGroupId, assetId, media.messageId, media.receivedAt, now);
    return { handled: true, reason: "album_item_stored", assetId, mediaGroupId: group.groupId, groupState: group.state };
  }

  async startSettlement(groupId: string, tenantId: string, workspaceId: string): Promise<boolean> { const result = await this.db.prepare("UPDATE media_groups SET state = 'settling' WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND state = 'collecting'").bind(groupId, tenantId, workspaceId).run(); return (result.meta?.changes ?? 0) > 0; }
  async markPendingConfirmation(groupId: string, tenantId: string, workspaceId: string): Promise<boolean> { const result = await this.db.prepare("UPDATE media_groups SET state = 'pending_confirmation' WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND state = 'settling'").bind(groupId, tenantId, workspaceId).run(); return (result.meta?.changes ?? 0) > 0; }
  async confirmGroup(groupId: string, tenantId: string, workspaceId: string, completedAt: string): Promise<boolean> { const result = await this.db.prepare("UPDATE media_groups SET state = 'completed', completed_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND state = 'pending_confirmation'").bind(completedAt, groupId, tenantId, workspaceId).run(); return (result.meta?.changes ?? 0) > 0; }
}
