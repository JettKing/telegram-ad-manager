import type { D1Like } from "@tg-ad-manager/telegram";
import type { ChannelPermissionSnapshot, ChannelRecheckInput, ChannelWriteInput } from "./channels.js";

interface ChannelRow { id: string; tenant_id: string; workspace_id: string; telegram_chat_id: string; username?: string; title: string; status: string; can_post: number; can_pin: number; can_delete: number; last_verified_at?: string }
interface ChannelForRecheck extends ChannelRow { bot_identity_id: string; updated_at: string }

export class ProductionChannelRepository {
  constructor(private readonly db: D1Like) {}

  async findByIdScoped(channelId: string, tenantId: string, workspaceId: string): Promise<ChannelForRecheck | null> {
    return this.db.prepare(`SELECT c.id, c.tenant_id, c.workspace_id, c.bot_identity_id, c.telegram_chat_id, c.username, c.title, c.status, COALESCE(p.can_post_messages, 0) AS can_post, COALESCE(p.can_pin_messages, 0) AS can_pin, COALESCE(p.can_delete_messages, 0) AS can_delete, c.last_verified_at, c.updated_at
      FROM telegram_channels c LEFT JOIN telegram_channel_permissions p ON p.channel_id = c.id AND p.tenant_id = c.tenant_id
      WHERE c.id = ? AND c.tenant_id = ? AND c.workspace_id = ? ORDER BY p.checked_at DESC LIMIT 1`).bind(channelId, tenantId, workspaceId).first<ChannelForRecheck>();
  }

  async listScoped(tenantId: string, workspaceId: string): Promise<ChannelRow[]> {
    const prepared = this.db.prepare(`SELECT c.id, c.tenant_id, c.workspace_id, c.telegram_chat_id, c.username, c.title, c.status, COALESCE(p.can_post_messages, 0) AS can_post, COALESCE(p.can_pin_messages, 0) AS can_pin, COALESCE(p.can_delete_messages, 0) AS can_delete, c.last_verified_at
      FROM telegram_channels c LEFT JOIN telegram_channel_permissions p ON p.channel_id = c.id AND p.tenant_id = c.tenant_id WHERE c.tenant_id = ? AND c.workspace_id = ? ORDER BY c.created_at DESC`).bind(tenantId, workspaceId);
    return prepared.all ? (await prepared.all<ChannelRow>()).results : [];
  }

  async upsertVerified(input: ChannelWriteInput): Promise<{ channelId: string; status: string }> {
    const status = input.verified.permissions.canPost ? "active" : "permission_error";
    const saved = await this.db.prepare(`INSERT INTO telegram_channels (id, tenant_id, workspace_id, bot_identity_id, telegram_chat_id, username, title, status, last_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (bot_identity_id, telegram_chat_id) DO UPDATE SET username = excluded.username, title = excluded.title, status = excluded.status, last_verified_at = excluded.last_verified_at,
      updated_at = CASE WHEN telegram_channels.updated_at < excluded.updated_at THEN excluded.updated_at ELSE strftime('%Y-%m-%dT%H:%M:%fZ', telegram_channels.updated_at, '+0.001 seconds') END
      WHERE telegram_channels.tenant_id = excluded.tenant_id AND telegram_channels.workspace_id = excluded.workspace_id RETURNING id`).bind(crypto.randomUUID(), input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, input.verified.username ?? null, input.verified.title, status, input.verified.permissions.checkedAt, input.now, input.now).first<{ id: string }>();
    if (!saved) throw new Error("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");
    const channelId = saved.id;
    await this.savePermissionSnapshot(channelId, input);
    return { channelId, status };
  }

  async recheckVerified(input: ChannelRecheckInput): Promise<{ channelId: string; status: string } | null> {
    const status = input.verified.permissions.canPost ? "active" : "permission_error";
    // A recheck may never insert or revive a channel. Monotonic updated_at also
    // detects an unbind/rebind occurring within the same clock millisecond.
    const saved = await this.db.prepare(`UPDATE telegram_channels SET username = ?, title = ?, status = ?, last_verified_at = ?,
      updated_at = CASE WHEN updated_at < ? THEN ? ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') END
      WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND bot_identity_id = ? AND telegram_chat_id = ?
      AND status IN ('active', 'permission_error') AND updated_at = ? RETURNING id, updated_at`).bind(input.verified.username ?? null, input.verified.title, status, input.verified.permissions.checkedAt, input.now, input.now, input.channelId, input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, input.expectedUpdatedAt).first<{ id: string; updated_at: string }>();
    if (!saved) return null;
    // D1Like does not expose transactions: each guarded snapshot write is separate.
    // Failures or concurrent changes can leave a partial/stale snapshot.
    if (!await this.savePermissionSnapshot(saved.id, input, { status, updatedAt: saved.updated_at })) return null;
    return { channelId: saved.id, status };
  }

  private async savePermissionSnapshot(channelId: string, input: ChannelWriteInput, recheck?: { status: string; updatedAt: string }): Promise<boolean> {
    const guard = recheck === undefined ? "" : ` AND EXISTS (SELECT 1 FROM telegram_channels
      WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND bot_identity_id = ? AND telegram_chat_id = ? AND status = ? AND last_verified_at = ? AND updated_at = ?)`;
    const guardArgs = recheck === undefined ? [] : [channelId, input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, recheck.status, input.verified.permissions.checkedAt, recheck.updatedAt];
    // The NOT EXISTS check is part of the insert, avoiding two concurrent initial snapshots.
    await this.db.prepare(`INSERT INTO telegram_channel_permissions (id, tenant_id, channel_id, can_post_messages, can_pin_messages, can_delete_messages, checked_at, error_code, error_message)
      SELECT ?, ?, ?, ?, ?, ?, ?, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM telegram_channel_permissions WHERE channel_id = ? AND tenant_id = ?)${guard}`).bind(crypto.randomUUID(), input.tenantId, channelId, input.verified.permissions.canPost ? 1 : 0, input.verified.permissions.canPin ? 1 : 0, input.verified.permissions.canDelete ? 1 : 0, input.verified.permissions.checkedAt, channelId, input.tenantId, ...guardArgs).run();
    const result = await this.db.prepare(`UPDATE telegram_channel_permissions SET can_post_messages = ?, can_pin_messages = ?, can_delete_messages = ?, checked_at = ?, error_code = NULL, error_message = NULL
      WHERE id = (SELECT id FROM telegram_channel_permissions WHERE channel_id = ? AND tenant_id = ? ORDER BY checked_at DESC LIMIT 1)${guard}`).bind(input.verified.permissions.canPost ? 1 : 0, input.verified.permissions.canPin ? 1 : 0, input.verified.permissions.canDelete ? 1 : 0, input.verified.permissions.checkedAt, channelId, input.tenantId, ...guardArgs).run();
    return recheck === undefined || (result.meta?.changes ?? 0) === 1;
  }

  async unbind(channelId: string, tenantId: string, workspaceId: string, now: string): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE telegram_channels SET status = 'unbound',
      updated_at = CASE WHEN updated_at < ? THEN ? ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') END
      WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status != 'unbound'`).bind(now, now, channelId, tenantId, workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}

export function productionPermissionSnapshot(row: { can_post: number; can_pin: number; can_delete: number; status: string; last_verified_at?: string }): ChannelPermissionSnapshot {
  return { canPost: row.can_post === 1, canPin: row.can_pin === 1, canDelete: row.can_delete === 1, botStatus: row.status === "active" ? "administrator" : "unknown", checkedAt: row.last_verified_at ?? new Date().toISOString() };
}
