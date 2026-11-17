import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";
import type { MediaIngestResult } from "./media.js";

interface AssetRow { id: string; media_type: "text" | "photo" | "video" | "animation" | "document"; file_id?: string; file_unique_id?: string; file_name?: string; mime_type?: string; file_size?: number; width?: number; height?: number; duration_seconds?: number; text_content?: string; caption?: string; media_group_id?: string; created_at: string }

export class ProductionMediaRepository {
  constructor(private readonly db: D1Like) {}
  async listAssets(tenantId: string, workspaceId: string): Promise<AssetRow[]> { const prepared = this.db.prepare(`SELECT id, media_type, file_id, file_unique_id, file_name, mime_type, file_size, width, height, duration_seconds, NULL AS text_content, caption, media_group_id, created_at FROM creative_media WHERE tenant_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 100`).bind(tenantId, workspaceId); return prepared.all ? (await prepared.all<AssetRow>()).results : []; }
  async ingest(_botIdentityId: string, _update: unknown, _now?: string): Promise<MediaIngestResult> { throw new BusinessValidationError("MEDIA_SOURCE_SCHEMA_REQUIRED", "生产 creative_media 缺少 Telegram message_id/source_chat_id 幂等字段，媒体 Webhook 入库需先执行 production media schema migration"); }
  async startSettlement(_groupId: string, _tenantId: string, _workspaceId: string): Promise<boolean> { throw new BusinessValidationError("MEDIA_GROUP_SCHEMA_REQUIRED", "生产 schema 当前没有相册状态表，无法安全推进相册状态"); }
  async markPendingConfirmation(_groupId: string, _tenantId: string, _workspaceId: string): Promise<boolean> { throw new BusinessValidationError("MEDIA_GROUP_SCHEMA_REQUIRED", "生产 schema 当前没有相册状态表，无法安全推进相册状态"); }
  async confirmGroup(_groupId: string, _tenantId: string, _workspaceId: string, _completedAt: string): Promise<boolean> { throw new BusinessValidationError("MEDIA_GROUP_SCHEMA_REQUIRED", "生产 schema 当前没有相册状态表，无法安全推进相册状态"); }
}
