export interface TelegramUpdate {
  update_id: number;
  [key: string]: unknown;
}

export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all?<T = unknown>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
}

export interface WebhookClaimResult {
  accepted: boolean;
  duplicate: boolean;
}

export interface WebhookUpdateStore {
  claim(update: TelegramUpdate, payloadJson: string, receivedAt: string): Promise<WebhookClaimResult>;
}

export function validateWebhookSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function parseTelegramUpdate(value: unknown): TelegramUpdate | null {
  if (!value || typeof value !== "object") return null;
  const update = value as Record<string, unknown>;
  return Number.isSafeInteger(update.update_id) && Number(update.update_id) >= 0 ? (update as TelegramUpdate) : null;
}

export class MemoryWebhookUpdateStore implements WebhookUpdateStore {
  private readonly updateIds = new Set<number>();

  async claim(update: TelegramUpdate): Promise<WebhookClaimResult> {
    if (this.updateIds.has(update.update_id)) return { accepted: false, duplicate: true };
    this.updateIds.add(update.update_id);
    return { accepted: true, duplicate: false };
  }
}

export class D1WebhookUpdateStore implements WebhookUpdateStore {
  constructor(private readonly db: D1Like, private readonly botIdentityId: string) {}

  async claim(update: TelegramUpdate, payloadJson: string, receivedAt: string): Promise<WebhookClaimResult> {
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO telegram_updates (update_id, bot_identity_id, payload_json, status, received_at)
       VALUES (?, ?, ?, 'received', ?)`,
    ).bind(update.update_id, this.botIdentityId, payloadJson, receivedAt).run();
    const accepted = (result.meta?.changes ?? 0) > 0;
    await this.db.prepare(
      `INSERT INTO telegram_webhook_logs (id, bot_identity_id, update_id, status, received_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), this.botIdentityId, update.update_id, accepted ? "received" : "duplicate", receivedAt).run();
    return { accepted, duplicate: !accepted };
  }
}

export class D1ReplayStore {
  constructor(private readonly db: D1Like) {}

  async claim(record: { replayKey: string; userId: string; authDate: number; expiresAt: number }): Promise<boolean> {
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO telegram_init_data_replays (replay_key, telegram_user_id, auth_date, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(record.replayKey, record.userId, record.authDate, record.expiresAt, new Date().toISOString()).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async has(replayKey: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT replay_key FROM telegram_init_data_replays WHERE replay_key = ? AND expires_at > ?").bind(replayKey, Math.floor(Date.now() / 1000)).first<{ replay_key: string }>();
    return Boolean(row);
  }

  async put(record: { replayKey: string; userId: string; authDate: number; expiresAt: number }): Promise<void> {
    await this.db.prepare(
      `INSERT INTO telegram_init_data_replays (replay_key, telegram_user_id, auth_date, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(record.replayKey, record.userId, record.authDate, record.expiresAt, new Date().toISOString()).run();
  }
}
