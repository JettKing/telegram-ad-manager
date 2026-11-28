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
  batch?(statements: unknown[]): Promise<Array<{ meta?: { changes?: number } }>>;
}

export interface WebhookClaimResult {
  accepted: boolean;
  duplicate: boolean;
  busy?: boolean;
}

export interface WebhookUpdateStore {
  claim(update: TelegramUpdate, payloadJson: string, receivedAt: string): Promise<WebhookClaimResult>;
  complete(updateId: number, processedAt: string): Promise<void>;
  release(updateId: number): Promise<void>;
}

const WEBHOOK_UPDATE_LEASE_MS = 30 * 60 * 1000;

export function validateWebhookSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function parseTelegramUpdate(value: unknown): TelegramUpdate | null {
  if (!value || typeof value !== "object") return null;
  const update = value as Record<string, unknown>;
  return Number.isSafeInteger(update.update_id) && Number(update.update_id) >= 0 ? (update as TelegramUpdate) : null;
}

export class MemoryWebhookUpdateStore implements WebhookUpdateStore {
  private readonly statuses = new Map<number, "received" | "processed">();

  async claim(update: TelegramUpdate): Promise<WebhookClaimResult> {
    const status = this.statuses.get(update.update_id);
    if (status === "processed") return { accepted: false, duplicate: true };
    if (status === "received") return { accepted: false, duplicate: false, busy: true };
    this.statuses.set(update.update_id, "received");
    return { accepted: true, duplicate: false };
  }

  async complete(updateId: number): Promise<void> {
    this.statuses.set(updateId, "processed");
  }

  async release(updateId: number): Promise<void> {
    if (this.statuses.get(updateId) === "received") this.statuses.delete(updateId);
  }
}

interface ExistingUpdate { status: string; received_at: string }

async function claimDevelopmentUpdate(db: D1Like, botIdentityId: string, update: TelegramUpdate, payloadJson: string, receivedAt: string): Promise<WebhookClaimResult> {
  const insert = () => db.prepare(`INSERT OR IGNORE INTO telegram_updates (update_id, bot_identity_id, payload_json, status, received_at) VALUES (?, ?, ?, 'received', ?)`).bind(update.update_id, botIdentityId, payloadJson, receivedAt).run();
  if ((await insert()).meta?.changes ?? 0) return { accepted: true, duplicate: false };

  let existing = await db.prepare("SELECT status, received_at FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? LIMIT 1").bind(update.update_id, botIdentityId).first<ExistingUpdate>();
  if (existing?.status === "processed") return { accepted: false, duplicate: true };
  if (existing?.status === "received" && Date.parse(existing.received_at) <= Date.parse(receivedAt) - WEBHOOK_UPDATE_LEASE_MS) {
    const removed = await db.prepare("DELETE FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? AND status = 'received' AND received_at = ?").bind(update.update_id, botIdentityId, existing.received_at).run();
    if ((removed.meta?.changes ?? 0) > 0 && ((await insert()).meta?.changes ?? 0) > 0) return { accepted: true, duplicate: false };
    existing = await db.prepare("SELECT status, received_at FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? LIMIT 1").bind(update.update_id, botIdentityId).first<ExistingUpdate>();
    if (existing?.status === "processed") return { accepted: false, duplicate: true };
  }
  return { accepted: false, duplicate: false, busy: true };
}

export class D1WebhookUpdateStore implements WebhookUpdateStore {
  constructor(private readonly db: D1Like, private readonly botIdentityId: string) {}

  async claim(update: TelegramUpdate, payloadJson: string, receivedAt: string): Promise<WebhookClaimResult> {
    const result = await claimDevelopmentUpdate(this.db, this.botIdentityId, update, payloadJson, receivedAt);
    await this.db.prepare(`INSERT INTO telegram_webhook_logs (id, bot_identity_id, update_id, status, received_at) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), this.botIdentityId, update.update_id, result.accepted ? "received" : "duplicate", receivedAt).run();
    return result;
  }

  async complete(updateId: number, processedAt: string): Promise<void> {
    await this.db.prepare("UPDATE telegram_updates SET status = 'processed', processed_at = ?, error_code = NULL, error_message = NULL WHERE update_id = ? AND bot_identity_id = ? AND status = 'received'").bind(processedAt, updateId, this.botIdentityId).run();
  }

  async release(updateId: number): Promise<void> {
    await this.db.prepare("DELETE FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? AND status = 'received'").bind(updateId, this.botIdentityId).run();
  }
}

export class ProductionD1WebhookUpdateStore implements WebhookUpdateStore {
  constructor(private readonly db: D1Like, private readonly botIdentityId: string) {}

  async claim(update: TelegramUpdate, payloadJson: string, receivedAt: string): Promise<WebhookClaimResult> {
    const insert = () => this.db.prepare(`INSERT OR IGNORE INTO telegram_updates (id, bot_identity_id, update_id, payload_json, processing_status, received_at) VALUES (?, ?, ?, ?, 'received', ?)`).bind(crypto.randomUUID(), this.botIdentityId, update.update_id, payloadJson, receivedAt).run();
    let result: WebhookClaimResult;
    if ((await insert()).meta?.changes ?? 0) result = { accepted: true, duplicate: false };
    else {
      let existing = await this.db.prepare("SELECT processing_status AS status, received_at FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? LIMIT 1").bind(update.update_id, this.botIdentityId).first<ExistingUpdate>();
      if (existing?.status === "processed") result = { accepted: false, duplicate: true };
      else if (existing?.status === "received" && Date.parse(existing.received_at) <= Date.parse(receivedAt) - WEBHOOK_UPDATE_LEASE_MS) {
        const removed = await this.db.prepare("DELETE FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? AND processing_status = 'received' AND received_at = ?").bind(update.update_id, this.botIdentityId, existing.received_at).run();
        if ((removed.meta?.changes ?? 0) > 0 && ((await insert()).meta?.changes ?? 0) > 0) result = { accepted: true, duplicate: false };
        else {
          existing = await this.db.prepare("SELECT processing_status AS status, received_at FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? LIMIT 1").bind(update.update_id, this.botIdentityId).first<ExistingUpdate>();
          result = existing?.status === "processed" ? { accepted: false, duplicate: true } : { accepted: false, duplicate: false, busy: true };
        }
      } else result = { accepted: false, duplicate: false, busy: true };
    }
    const responseCode = result.busy ? 503 : 200;
    await this.db.prepare(`INSERT INTO telegram_webhook_logs (id, bot_identity_id, update_id, request_id, status, response_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), this.botIdentityId, update.update_id, crypto.randomUUID(), result.accepted ? "accepted" : "rejected", responseCode, receivedAt).run();
    return result;
  }

  async complete(updateId: number): Promise<void> {
    await this.db.prepare("UPDATE telegram_updates SET processing_status = 'processed' WHERE update_id = ? AND bot_identity_id = ? AND processing_status = 'received'").bind(updateId, this.botIdentityId).run();
  }

  async release(updateId: number): Promise<void> {
    await this.db.prepare("DELETE FROM telegram_updates WHERE update_id = ? AND bot_identity_id = ? AND processing_status = 'received'").bind(updateId, this.botIdentityId).run();
  }
}

export class D1ReplayStore {
  constructor(private readonly db: D1Like) {}
  async claim(record: { replayKey: string; userId: string; authDate: number; expiresAt: number }): Promise<boolean> {
    const result = await this.db.prepare(`INSERT OR IGNORE INTO telegram_init_data_replays (replay_key, telegram_user_id, auth_date, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).bind(record.replayKey, record.userId, record.authDate, record.expiresAt, new Date().toISOString()).run();
    return (result.meta?.changes ?? 0) > 0;
  }
  async has(replayKey: string): Promise<boolean> { const row = await this.db.prepare("SELECT replay_key FROM telegram_init_data_replays WHERE replay_key = ? AND expires_at > ?").bind(replayKey, Math.floor(Date.now() / 1000)).first<{ replay_key: string }>(); return Boolean(row); }
  async put(record: { replayKey: string; userId: string; authDate: number; expiresAt: number }): Promise<void> { await this.db.prepare(`INSERT INTO telegram_init_data_replays (replay_key, telegram_user_id, auth_date, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).bind(record.replayKey, record.userId, record.authDate, record.expiresAt, new Date().toISOString()).run(); }
}
