export const ASSETS = [
  { code: "CNY", label: "CNY 人民币", scale: 2, networks: [] as string[] },
  { code: "USD", label: "USD 美元", scale: 2, networks: [] as string[] },
  { code: "TON", label: "TON", scale: 9, networks: ["TON"] },
  { code: "USDT", label: "USDT", scale: 6, networks: ["TON", "TRON"] },
] as const;
export type AssetCode = (typeof ASSETS)[number]["code"];
export function assetScale(currency?: string, storedScale?: number): number {
  if (Number.isInteger(storedScale) && storedScale! >= 0 && storedScale! <= 12) return storedScale!;
  return ASSETS.find((asset) => asset.code === currency)?.scale ?? 2;
}
export function parseAtomicAmount(input: string, scale: number): number {
  const value = input.trim();
  if (!/^\d+(?:\.\d*)?$/.test(value)) throw new Error("请输入有效的非负金额");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) throw new Error(`该币种最多支持 ${scale} 位小数`);
  const atomic = BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  if (atomic <= 0n) throw new Error("金额必须大于 0");
  if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("金额超过系统安全范围");
  return Number(atomic);
}
export function formatMoney(amount: number, currency = "CNY", scale = assetScale(currency), network?: string | null): string {
  const atomic = BigInt(Math.trunc(amount || 0));
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fraction = scale ? `.${(absolute % divisor).toString().padStart(scale, "0")}` : "";
  const groupedWhole = Number(whole).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  const formatted = `${negative ? "-" : ""}${groupedWhole}${fraction}`;
  return `${formatted} ${currency}${network ? ` · ${network}` : ""}`;
}
