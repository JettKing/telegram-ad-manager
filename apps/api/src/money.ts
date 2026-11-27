import { BusinessValidationError } from "./errors.js";

export const ASSET_OPTIONS = [
  { code: "CNY", label: "CNY 人民币", scale: 2, networks: [] as string[] },
  { code: "USD", label: "USD 美元", scale: 2, networks: [] as string[] },
  { code: "TON", label: "TON", scale: 9, networks: ["TON"] },
  { code: "USDT", label: "USDT", scale: 6, networks: ["TON", "TRON"] },
] as const;

export type AssetCode = (typeof ASSET_OPTIONS)[number]["code"];
export type AssetDetails = { currency: AssetCode; scale: number; network: string | null };

export function resolveAsset(value: unknown, networkValue?: unknown): AssetDetails {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  const asset = ASSET_OPTIONS.find((item) => item.code === currency);
  if (!asset) throw new BusinessValidationError("UNSUPPORTED_CURRENCY", "币种/资产仅支持 CNY、USD、TON、USDT");
  const network = typeof networkValue === "string" && networkValue.trim() ? networkValue.trim().toUpperCase() : null;
  if (asset.networks.length === 0) {
    if (network) throw new BusinessValidationError("INVALID_ASSET_NETWORK", `${currency} 不应填写区块链网络`);
    return { currency: asset.code, scale: asset.scale, network: null };
  }
  const supportedNetworks: readonly string[] = asset.networks;
  const resolvedNetwork = network ?? (supportedNetworks.length === 1 ? supportedNetworks[0] : null);
  if (!resolvedNetwork || !supportedNetworks.includes(resolvedNetwork)) {
    throw new BusinessValidationError("INVALID_ASSET_NETWORK", `${currency} 必须选择支持的网络：${asset.networks.join("、")}`);
  }
  return { currency: asset.code, scale: asset.scale, network: resolvedNetwork };
}

export function assetLabel(currency: string, network?: string | null): string {
  return network ? `${currency} · ${network}` : currency;
}
