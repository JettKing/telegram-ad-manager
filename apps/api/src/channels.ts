import type { D1Like } from "@tg-ad-manager/telegram";

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChatMember {
  status: string;
  user: TelegramUser;
  can_post_messages?: boolean;
  can_edit_messages?: boolean;
  can_delete_messages?: boolean;
  can_pin_messages?: boolean;
}

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export class TelegramApiError extends Error {
  constructor(public readonly method: string, public readonly errorCode: number | undefined, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export interface TelegramBotApi {
  getMe(): Promise<TelegramUser>;
  getChat(chatId: string): Promise<TelegramChat>;
  getChatMember(chatId: string, userId: number): Promise<TelegramChatMember>;
  sendMessage(chatId: string, text: string, options?: { reply_markup?: Record<string, unknown> }): Promise<{ message_id: number }>;
}

export class TelegramBotApiClient implements TelegramBotApi {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch, private readonly baseUrl = "https://api.telegram.org") {}

  private async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.token.trim()) throw new TelegramApiError(method, undefined, "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED");
    const response = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let envelope: TelegramApiEnvelope<T>;
    try {
      envelope = await response.json() as TelegramApiEnvelope<T>;
    } catch {
      throw new TelegramApiError(method, response.status, "TELEGRAM_INVALID_RESPONSE");
    }
    if (!response.ok || !envelope.ok || envelope.result === undefined) {
      throw new TelegramApiError(method, envelope.error_code ?? response.status, envelope.description ?? "Telegram API request failed", envelope.parameters?.retry_after);
    }
    return envelope.result;
  }

  getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe");
  }

  getChat(chatId: string): Promise<TelegramChat> {
    return this.call<TelegramChat>("getChat", { chat_id: chatId });
  }

  getChatMember(chatId: string, userId: number): Promise<TelegramChatMember> {
    return this.call<TelegramChatMember>("getChatMember", { chat_id: chatId, user_id: userId });
  }

  sendMessage(chatId: string, text: string, options?: { reply_markup?: Record<string, unknown> }): Promise<{ message_id: number }> {
    return this.call("sendMessage", { chat_id: chatId, text, ...options });
  }

  sendPhoto(chatId: string, fileId: string, caption?: string): Promise<{ message_id: number }> {
    return this.call("sendPhoto", { chat_id: chatId, photo: fileId, ...(caption ? { caption } : {}) });
  }

  sendVideo(chatId: string, fileId: string, caption?: string): Promise<{ message_id: number }> {
    return this.call("sendVideo", { chat_id: chatId, video: fileId, ...(caption ? { caption } : {}) });
  }

  sendDocument(chatId: string, fileId: string, caption?: string): Promise<{ message_id: number }> {
    return this.call("sendDocument", { chat_id: chatId, document: fileId, ...(caption ? { caption } : {}) });
  }

  deleteMessage(chatId: string, messageId: number): Promise<boolean> {
    return this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  pinChatMessage(chatId: string, messageId: number): Promise<boolean> {
    return this.call("pinChatMessage", { chat_id: chatId, message_id: messageId, disable_notification: true });
  }

  unpinChatMessage(chatId: string, messageId?: number): Promise<boolean> {
    return this.call("unpinChatMessage", { chat_id: chatId, ...(messageId ? { message_id: messageId } : {}) });
  }
}

export interface ChannelPermissionSnapshot {
  canPost: boolean;
  canPin: boolean;
  canDelete: boolean;
  botStatus: "creator" | "administrator" | "not_admin" | "unknown";
  checkedAt: string;
}

export interface VerifiedChannel {
  telegramChatId: string;
  title: string;
  username?: string;
  permissions: ChannelPermissionSnapshot;
}

export interface ChannelWriteInput {
  tenantId: string;
  workspaceId: string;
  botIdentityId: string;
  verified: VerifiedChannel;
  now: string;
}

export interface ChannelRecheckInput extends ChannelWriteInput {
  channelId: string;
  expectedUpdatedAt: string;
}

export class ChannelCheckError extends Error {
  constructor(public readonly code: "NOT_CHANNEL" | "BOT_NOT_ADMIN" | "POST_PERMISSION_REQUIRED" | "TELEGRAM_CHECK_FAILED" | "INVALID_TELEGRAM_USER_ID" | "USER_NOT_ADMIN", message: string) {
    super(message);
    this.name = "ChannelCheckError";
  }
}

export function deriveChannelPermissions(member: TelegramChatMember, checkedAt = new Date().toISOString()): ChannelPermissionSnapshot {
  const isCreator = member.status === "creator";
  const isAdmin = isCreator || member.status === "administrator";
  return {
    canPost: isAdmin && (isCreator || member.can_post_messages === true),
    canPin: isAdmin && (isCreator || member.can_edit_messages === true || member.can_pin_messages === true),
    canDelete: isAdmin && (isCreator || member.can_delete_messages === true),
    botStatus: isCreator ? "creator" : member.status === "administrator" ? "administrator" : "not_admin",
    checkedAt,
  };
}

export async function verifyTelegramChannel(client: TelegramBotApi, chatId: string, checkedAt = new Date().toISOString()): Promise<VerifiedChannel> {
  try {
    const chat = await client.getChat(chatId);
    if (chat.type !== "channel") throw new ChannelCheckError("NOT_CHANNEL", "目标聊天不是 Telegram channel");
    if (!Number.isSafeInteger(chat.id) || chat.id === 0) throw new Error("INVALID_CHAT_ID");
    const bot = await client.getMe();
    const member = await client.getChatMember(String(chat.id), bot.id);
    const permissions = deriveChannelPermissions(member, checkedAt);
    return { telegramChatId: String(chat.id), title: chat.title ?? "未命名频道", username: chat.username, permissions };
  } catch (error) {
    if (error instanceof ChannelCheckError) throw error;
    // Network and upstream error messages can contain the token-bearing URL.
    throw new ChannelCheckError("TELEGRAM_CHECK_FAILED", "Telegram 频道权限检查失败，请稍后重试并确认 Bot 已加入频道");
  }
}

/** Binding additionally requires proof for the session user; rechecks intentionally only verify the Bot. */
export async function verifyTelegramChannelForBinding(client: TelegramBotApi, chatId: string, telegramUserId: unknown, checkedAt = new Date().toISOString()): Promise<VerifiedChannel> {
  // Reject coercion, rounded integers, signs, whitespace and non-canonical IDs before calling Telegram.
  if (typeof telegramUserId !== "string" || !/^[1-9][0-9]*$/.test(telegramUserId)) {
    throw new ChannelCheckError("INVALID_TELEGRAM_USER_ID", "当前会话的 Telegram 用户 ID 无效，请重新登录");
  }
  const userId = Number(telegramUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ChannelCheckError("INVALID_TELEGRAM_USER_ID", "当前会话的 Telegram 用户 ID 无效，请重新登录");
  }
  const verified = await verifyTelegramChannel(client, chatId, checkedAt);
  try {
    // Use the resolved numeric chat ID, not a mutable username or a request-supplied user ID.
    const member = await client.getChatMember(verified.telegramChatId, userId);
    if (!member || !member.user || member.user.id !== userId || member.user.is_bot !== false || typeof member.status !== "string") {
      throw new Error("INVALID_MEMBER_RESPONSE");
    }
    if (member.status === "creator" || member.status === "administrator") return verified;
    if (["member", "restricted", "left", "kicked"].includes(member.status)) {
      throw new ChannelCheckError("USER_NOT_ADMIN", "当前 Telegram 用户必须是目标频道的创建者或管理员");
    }
    throw new Error("UNKNOWN_MEMBER_STATUS");
  } catch (error) {
    if (error instanceof ChannelCheckError) throw error;
    throw new ChannelCheckError("TELEGRAM_CHECK_FAILED", "无法验证当前 Telegram 用户的频道管理员身份，请稍后重试");
  }
}

interface ChannelRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  telegram_chat_id: string;
  username?: string;
  title: string;
  status: string;
  can_post: number;
  can_pin: number;
  can_delete: number;
  last_verified_at?: string;
}

interface ChannelForRecheck extends ChannelRow {
  bot_identity_id: string;
  updated_at: string;
}

export class D1ChannelRepository {
  constructor(private readonly db: D1Like) {}

  async findByIdScoped(channelId: string, tenantId: string, workspaceId: string): Promise<ChannelForRecheck | null> {
    return this.db.prepare(
      `SELECT id, tenant_id, workspace_id, bot_identity_id, telegram_chat_id, username, title, status, can_post, can_pin, can_delete, last_verified_at, updated_at
       FROM telegram_channels WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1`,
    ).bind(channelId, tenantId, workspaceId).first<ChannelForRecheck>();
  }

  async listScoped(tenantId: string, workspaceId: string): Promise<ChannelRow[]> {
    const prepared = this.db.prepare(
      `SELECT id, tenant_id, workspace_id, telegram_chat_id, username, title, status, can_post, can_pin, can_delete, last_verified_at
       FROM telegram_channels WHERE tenant_id = ? AND workspace_id = ? ORDER BY created_at DESC`,
    ).bind(tenantId, workspaceId);
    if (!prepared.all) return [];
    const result = await prepared.all<ChannelRow>();
    return result.results;
  }

  async upsertVerified(input: ChannelWriteInput): Promise<{ channelId: string; status: string }> {
    const status = input.verified.permissions.canPost ? "active" : "permission_error";
    // The conflict predicate and RETURNING make ownership and the winning row ID one atomic decision.
    const saved = await this.db.prepare(
      `INSERT INTO telegram_channels (id, tenant_id, workspace_id, bot_identity_id, telegram_chat_id, username, title, status, can_post, can_pin, can_delete, last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot_identity_id, telegram_chat_id) DO UPDATE SET username = excluded.username, title = excluded.title, status = excluded.status, can_post = excluded.can_post, can_pin = excluded.can_pin, can_delete = excluded.can_delete, last_verified_at = excluded.last_verified_at,
       updated_at = CASE WHEN telegram_channels.updated_at < excluded.updated_at THEN excluded.updated_at ELSE strftime('%Y-%m-%dT%H:%M:%fZ', telegram_channels.updated_at, '+0.001 seconds') END
       WHERE telegram_channels.tenant_id = excluded.tenant_id AND telegram_channels.workspace_id = excluded.workspace_id
       RETURNING id`,
    ).bind(crypto.randomUUID(), input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, input.verified.username ?? null, input.verified.title, status, input.verified.permissions.canPost ? 1 : 0, input.verified.permissions.canPin ? 1 : 0, input.verified.permissions.canDelete ? 1 : 0, input.verified.permissions.checkedAt, input.now, input.now).first<{ id: string }>();
    if (!saved) throw new Error("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");
    const channelId = saved.id;

    await this.savePermissionSnapshot(channelId, input);
    return { channelId, status };
  }

  async recheckVerified(input: ChannelRecheckInput): Promise<{ channelId: string; status: string } | null> {
    const status = input.verified.permissions.canPost ? "active" : "permission_error";
    // Never insert here: only already-bound rows may be refreshed. The monotonic
    // updated_at version rejects a same-millisecond unbind followed by a rebind.
    const saved = await this.db.prepare(
      `UPDATE telegram_channels SET username = ?, title = ?, status = ?, can_post = ?, can_pin = ?, can_delete = ?, last_verified_at = ?,
       updated_at = CASE WHEN updated_at < ? THEN ? ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') END
       WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND bot_identity_id = ? AND telegram_chat_id = ?
       AND status IN ('active', 'permission_error') AND updated_at = ? RETURNING id, updated_at`,
    ).bind(input.verified.username ?? null, input.verified.title, status, input.verified.permissions.canPost ? 1 : 0, input.verified.permissions.canPin ? 1 : 0, input.verified.permissions.canDelete ? 1 : 0, input.verified.permissions.checkedAt, input.now, input.now, input.channelId, input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, input.expectedUpdatedAt).first<{ id: string; updated_at: string }>();
    if (!saved) return null;
    // D1Like has no transaction/batch API. Guard every separate snapshot write;
    // a failure or concurrent change can still leave a partial/stale snapshot.
    if (!await this.savePermissionSnapshot(saved.id, input, { status, updatedAt: saved.updated_at })) return null;
    return { channelId: saved.id, status };
  }

  private async savePermissionSnapshot(channelId: string, input: ChannelWriteInput, recheck?: { status: string; updatedAt: string }): Promise<boolean> {
    const guard = recheck === undefined ? "" : ` WHERE EXISTS (SELECT 1 FROM telegram_channels
      WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND bot_identity_id = ? AND telegram_chat_id = ? AND status = ? AND last_verified_at = ? AND updated_at = ?)`;
    const guardArgs = recheck === undefined ? [] : [channelId, input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, recheck.status, input.verified.permissions.checkedAt, recheck.updatedAt];
    for (const permission of ["post", "pin", "delete"] as const) {
      const granted = permission === "post" ? input.verified.permissions.canPost : permission === "pin" ? input.verified.permissions.canPin : input.verified.permissions.canDelete;
      const result = await this.db.prepare(
        `INSERT INTO telegram_channel_permissions (id, channel_id, permission, granted, checked_at)
         SELECT ?, ?, ?, ?, ?${guard || " WHERE 1"}
         ON CONFLICT (channel_id, permission) DO UPDATE SET granted = excluded.granted, checked_at = excluded.checked_at`,
      ).bind(crypto.randomUUID(), channelId, permission, granted ? 1 : 0, input.verified.permissions.checkedAt, ...guardArgs).run();
      if (recheck !== undefined && (result.meta?.changes ?? 0) !== 1) return false;
    }
    return true;
  }

  async unbind(channelId: string, tenantId: string, workspaceId: string, now: string): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE telegram_channels SET status = 'unbound',
       updated_at = CASE WHEN updated_at < ? THEN ? ELSE strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds') END
       WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status != 'unbound'`,
    ).bind(now, now, channelId, tenantId, workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}
