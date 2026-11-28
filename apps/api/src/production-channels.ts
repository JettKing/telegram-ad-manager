import type { D1Like } from "@tg-ad-manager/telegram";
import type { ChannelPermissionSnapshot, VerifiedChannel } from "./channels.js";

interface ChannelRow { id: string; tenant_id: string; workspace_id: string; telegram_chat_id: string; username?: string; title: string; status: string; can_post: number; can_pin: number; can_delete: number; last_verified_at?: string }

export class ProductionChannelRepository {
  constructor(private readonly db: D1Like) {}

  async findByIdScoped(channelId: string, tenantId: string, workspaceId: string): Promise<ChannelRow | null> {
    return this.db.prepare(`SELECT c.id, c.tenant_id, c.workspace_id, c.telegram_chat_id, c.username, c.title, c.status, COALESCE(p.can_post_messages, 0) AS can_post, COALESCE(p.can_pin_messages, 0) AS can_pin, COALESCE(p.can_delete_messages, 0) AS can_delete, c.last_verified_at
      FROM telegram_channels c LEFT JOIN telegram_channel_permissions p ON p.channel_id = c.id AND p.tenant_id = c.tenant_id
      WHERE c.id = ? AND c.tenant_id = ? AND c.workspace_id = ? ORDER BY p.checked_at DESC LIMIT 1`).bind(channelId, tenantId, workspaceId).first<ChannelRow>();
  }

  async listScoped(tenantId: string, workspaceId: string): Promise<ChannelRow[]> {
    const prepared = this.db.prepare(`SELECT c.id, c.tenant_id, c.workspace_id, c.telegram_chat_id, c.username, c.title, c.status, COALESCE(p.can_post_messages, 0) AS can_post, COALESCE(p.can_pin_messages, 0) AS can_pin, COALESCE(p.can_delete_messages, 0) AS can_delete, c.last_verified_at
      FROM telegram_channels c LEFT JOIN telegram_channel_permissions p ON p.channel_id = c.id AND p.tenant_id = c.tenant_id WHERE c.tenant_id = ? AND c.workspace_id = ? ORDER BY c.created_at DESC`).bind(tenantId, workspaceId);
    return prepared.all ? (await prepared.all<ChannelRow>()).results : [];
  }

  async upsertVerified(input: { tenantId: string; workspaceId: string; botIdentityId: string; verified: VerifiedChannel; now: string }): Promise<{ channelId: string; status: string }> {
    const existing = await this.db.prepare("SELECT id, tenant_id, workspace_id FROM telegram_channels WHERE bot_identity_id = ? AND telegram_chat_id = ? LIMIT 1").bind(input.botIdentityId, input.verified.telegramChatId).first<{ id: string; tenant_id: string; workspace_id: string }>();
    if (existing && (existing.tenant_id !== input.tenantId || existing.workspace_id !== input.workspaceId)) throw new Error("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");
    const channelId = existing?.id ?? crypto.randomUUID(); const status = input.verified.permissions.canPost ? "active" : "permission_error";
    const write = await this.db.prepare(`INSERT INTO telegram_channels (id, tenant_id, workspace_id, bot_identity_id, telegram_chat_id, username, title, status, last_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (bot_identity_id, telegram_chat_id) DO UPDATE SET tenant_id = excluded.tenant_id, workspace_id = excluded.workspace_id, username = excluded.username, title = excluded.title, status = excluded.status, last_verified_at = excluded.last_verified_at, updated_at = excluded.updated_at
      WHERE telegram_channels.tenant_id = excluded.tenant_id AND telegram_channels.workspace_id = excluded.workspace_id`).bind(channelId, input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, input.verified.username ?? null, input.verified.title, status, input.verified.permissions.checkedAt, input.now, input.now).run();
    if ((write.meta?.changes ?? 0) === 0) throw new Error("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");
    const current = await this.db.prepare("SELECT id FROM telegram_channel_permissions WHERE channel_id = ? AND tenant_id = ? ORDER BY checked_at DESC LIMIT 1").bind(channelId, input.tenantId).first<{ id: string }>();
    if (current) await this.db.prepare("UPDATE telegram_channel_permissions SET can_post_messages = ?, can_pin_messages = ?, can_delete_messages = ?, checked_at = ?, error_code = NULL, error_message = NULL WHERE id = ?").bind(input.verified.permissions.canPost ? 1 : 0, input.verified.permissions.canPin ? 1 : 0, input.verified.permissions.canDelete ? 1 : 0, input.verified.permissions.checkedAt, current.id).run();
    else await this.db.prepare(`INSERT INTO telegram_channel_permissions (id, tenant_id, channel_id, can_post_messages, can_pin_messages, can_delete_messages, checked_at, error_code, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`).bind(crypto.randomUUID(), input.tenantId, channelId, input.verified.permissions.canPost ? 1 : 0, input.verified.permissions.canPin ? 1 : 0, input.verified.permissions.canDelete ? 1 : 0, input.verified.permissions.checkedAt).run();
    return { channelId, status };
  }

  async unbind(channelId: string, tenantId: string, workspaceId: string, now: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE telegram_channels SET status = 'unbound', updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status != 'unbound'").bind(now, channelId, tenantId, workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}

export function productionPermissionSnapshot(row: { can_post: number; can_pin: number; can_delete: number; status: string; last_verified_at?: string }): ChannelPermissionSnapshot {
  return { canPost: row.can_post === 1, canPin: row.can_pin === 1, canDelete: row.can_delete === 1, botStatus: row.status === "active" ? "administrator" : "unknown", checkedAt: row.last_verified_at ?? new Date().toISOString() };
}
