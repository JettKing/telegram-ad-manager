import type { ServiceState } from "@tg-ad-manager/contracts";

export interface TelegramInitDataValidation {
  valid: boolean;
  reason?: "missing" | "expired" | "invalid_signature" | "invalid_format" | "not_configured";
  userId?: string;
}

export function telegramServiceState(token: string | undefined): ServiceState {
  return token?.trim() ? "configured" : "not_configured";
}

/**
 * Production TODO: implement Telegram WebApp initData HMAC-SHA256 verification
 * with the bot token-derived secret key, auth_date freshness check, and replay protection.
 * This boundary intentionally refuses to claim validation until the bot secret is present.
 */
export function validateTelegramInitData(
  rawInitData: string | undefined,
  botToken: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 86_400,
): TelegramInitDataValidation {
  if (!rawInitData?.trim()) return { valid: false, reason: "missing" };
  if (!botToken?.trim()) return { valid: false, reason: "not_configured" };

  const params = new URLSearchParams(rawInitData);
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSeconds - authDate > maxAgeSeconds || authDate > nowSeconds + 60) {
    return { valid: false, reason: "expired" };
  }

  const user = params.get("user");
  if (!user) return { valid: false, reason: "invalid_format" };

  // Do not accept unverified payloads as valid. The crypto implementation is added with the
  // Telegram integration stage where Web Crypto and the Bot identity scope are configured.
  return { valid: false, reason: "invalid_signature" };
}
