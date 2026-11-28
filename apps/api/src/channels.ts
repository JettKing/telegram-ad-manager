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
    const response = await this.fetchImpl.call(globalThis, `${this.baseUrl}/bot${this.token}/${method}`, {
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

export class ChannelCheckError extends Error {
  constructor(public readonly code: "NOT_CHANNEL" | "BOT_NOT_ADMIN" | "POST_PERMISSION_REQUIRED" | "TELEGRAM_CHECK_FAILED", message: string) {
    super(message);
    this.name = "ChannelCheckError";
  }
}

export function deriveChannelPermissions(member: TelegramChatMember, checkedAt = new Date().toISOString()): ChannelPermissionSnapshot {
  const isCreator = member.status === "creator";
  const isAdmin = isCreator || member.status === "administrator";
  return {
    canPost: isCreator || member.can_post_messages === true,
    canPin: isCreator || member.can_edit_messages === true || member.can_pin_messages === true,
    canDelete: isCreator || member.can_delete_messages === true,
    botStatus: isCreator ? "creator" : member.status === "administrator" ? "administrator" : "not_admin",
    checkedAt,
  };
}

export async function verifyTelegramChannel(client: TelegramBotApi, chatId: string, checkedAt = new Date().toISOString()): Promise<VerifiedChannel> {
  try {
    const chat = await client.getChat(chatId);
    if (chat.type !== "channel") throw new ChannelCheckError("NOT_CHANNEL", "目标聊天不是 Telegram channel");
    const bot = await client.getMe();
    const member = await client.getChatMember(String(chat.id), bot.id);
    const permissions = deriveChannelPermissions(member, checkedAt);
    return { telegramChatId: String(chat.id), title: chat.title ?? "未命名频道", username: chat.username, permissions };
  } catch (error) {
    if (error instanceof ChannelCheckError) throw error;
    throw new ChannelCheckError("TELEGRAM_CHECK_FAILED", error instanceof Error ? error.message : "Telegram 权限检查失败");
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

export class D1ChannelRepository {
  constructor(private readonly db: D1Like) {}

  async findByIdScoped(channelId: string, tenantId: string, workspaceId: string): Promise<ChannelRow | null> {
    return this.db.prepare(
      `SELECT id, tenant_id, workspace_id, telegram_chat_id, username, title, status, can_post, can_pin, can_delete, last_verified_at
       FROM telegram_channels WHERE id = ? AND tenant_id = ? AND workspace_id = ? LIMIT 1`,
    ).bind(channelId, tenantId, workspaceId).first<ChannelRow>();
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

  async upsertVerified(input: {
    tenantId: string;
    workspaceId: string;
    botIdentityId: string;
    verified: VerifiedChannel;
    now: string;
  }): Promise<{ channelId: string; status: string }> {
    const existing = await this.db.prepare(
      `SELECT id, tenant_id, workspace_id FROM telegram_channels WHERE bot_identity_id = ? AND telegram_chat_id = ? LIMIT 1`,
    ).bind(input.botIdentityId, input.verified.telegramChatId).first<{ id: string; tenant_id: string; workspace_id: string }>();
    if (existing && (existing.tenant_id !== input.tenantId || existing.workspace_id !== input.workspaceId)) throw new Error("CHANNEL_ALREADY_BOUND_TO_ANOTHER_WORKSPACE");

    const channelId = existing?.id ?? crypto.randomUUID();
    const status = input.verified.permissions.canPost ? "active" : "permission_error";
    await this.db.prepare(
      `INSERT INTO telegram_channels (id, tenant_id, workspace_id, bot_identity_id, telegram_chat_id, username, title, status, can_post, can_pin, can_delete, last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot_identity_id, telegram_chat_id) DO UPDATE SET tenant_id = excluded.tenant_id, workspace_id = excluded.workspace_id, username = excluded.username, title = excluded.title, status = excluded.status, can_post = excluded.can_post, can_pin = excluded.can_pin, can_delete = excluded.can_delete, last_verified_at = excluded.last_verified_at, updated_at = excluded.updated_at`,
    ).bind(channelId, input.tenantId, input.workspaceId, input.botIdentityId, input.verified.telegramChatId, input.verified.username ?? null, input.verified.title, status, input.verified.permissions.canPost ? 1 : 0, input.verified.permissions.canPin ? 1 : 0, input.verified.permissions.canDelete ? 1 : 0, input.verified.permissions.checkedAt, input.now, input.now).run();

    for (const permission of ["post", "pin", "delete"] as const) {
      const granted = permission === "post" ? input.verified.permissions.canPost : permission === "pin" ? input.verified.permissions.canPin : input.verified.permissions.canDelete;
      await this.db.prepare(
        `INSERT INTO telegram_channel_permissions (id, channel_id, permission, granted, checked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel_id, permission) DO UPDATE SET granted = excluded.granted, checked_at = excluded.checked_at`,
      ).bind(crypto.randomUUID(), channelId, permission, granted ? 1 : 0, input.verified.permissions.checkedAt).run();
    }
    return { channelId, status };
  }

  async unbind(channelId: string, tenantId: string, workspaceId: string, now: string): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE telegram_channels SET status = 'unbound', updated_at = ? WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND status != 'unbound'`,
    ).bind(now, channelId, tenantId, workspaceId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}
