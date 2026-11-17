import type { ServiceState } from "@tg-ad-manager/contracts";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface InitDataReplayStore {
  has(replayKey: string): Promise<boolean>;
  put(record: { replayKey: string; userId: string; authDate: number; expiresAt: number }): Promise<void>;
  claim?(record: { replayKey: string; userId: string; authDate: number; expiresAt: number }): Promise<boolean>;
}

export interface TelegramInitDataValidation {
  valid: boolean;
  reason?: "missing" | "expired" | "invalid_signature" | "invalid_format" | "not_configured" | "replay" | "replay_store_unavailable";
  userId?: string;
  user?: TelegramUser;
  authDate?: number;
  replayKey?: string;
}

export interface InitDataValidationOptions {
  nowSeconds?: number;
  maxAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
  replayStore?: InitDataReplayStore;
}

export function telegramServiceState(token: string | undefined): ServiceState {
  return token?.trim() ? "configured" : "not_configured";
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, data as unknown as BufferSource);
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value) as unknown as BufferSource));
}

function constantTimeHexEqual(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actual) || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function parseUser(rawUser: string | null): TelegramUser | undefined {
  if (!rawUser) return undefined;
  try {
    const value = JSON.parse(rawUser) as Partial<TelegramUser>;
    if (!Number.isInteger(value.id) || value.id! <= 0) return undefined;
    return value as TelegramUser;
  } catch {
    return undefined;
  }
}

export async function validateTelegramInitData(
  rawInitData: string | undefined,
  botToken: string | undefined,
  options: InitDataValidationOptions = {},
): Promise<TelegramInitDataValidation> {
  if (!rawInitData?.trim()) return { valid: false, reason: "missing" };
  if (!botToken?.trim()) return { valid: false, reason: "not_configured" };

  const params = new URLSearchParams(rawInitData);
  const suppliedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const user = parseUser(params.get("user"));
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 86_400;
  const maxFutureSkewSeconds = options.maxFutureSkewSeconds ?? 60;

  if (!suppliedHash || !Number.isSafeInteger(authDate) || !user) return { valid: false, reason: "invalid_format" };
  if (nowSeconds - authDate > maxAgeSeconds || authDate > nowSeconds + maxFutureSkewSeconds) return { valid: false, reason: "expired", authDate, userId: String(user.id) };

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = new Uint8Array(await hmacSha256(new TextEncoder().encode(botToken), new TextEncoder().encode("WebAppData")));
  const calculatedHash = bytesToHex(await hmacSha256(secretKey, new TextEncoder().encode(dataCheckString)));

  if (!constantTimeHexEqual(calculatedHash, suppliedHash)) return { valid: false, reason: "invalid_signature", authDate, userId: String(user.id) };

  const replayKey = await sha256Hex(rawInitData);
  if (options.replayStore) {
    try {
      const record = { replayKey, userId: String(user.id), authDate, expiresAt: authDate + maxAgeSeconds };
      if (options.replayStore.claim) {
        if (!(await options.replayStore.claim(record))) return { valid: false, reason: "replay", authDate, userId: String(user.id), replayKey };
      } else {
        if (await options.replayStore.has(replayKey)) return { valid: false, reason: "replay", authDate, userId: String(user.id), replayKey };
        await options.replayStore.put(record);
      }
    } catch {
      return { valid: false, reason: "replay_store_unavailable", authDate, userId: String(user.id), replayKey };
    }
  }

  return { valid: true, userId: String(user.id), user, authDate, replayKey };
}

export * from "./webhook.js";
