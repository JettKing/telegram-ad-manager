import type { ApiResponse, HealthPayload } from "@tg-ad-manager/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export async function getHealth(signal?: AbortSignal): Promise<ApiResponse<HealthPayload>> {
  const response = await fetch(`${API_BASE_URL}/api/v1/health`, { signal, headers: { Accept: "application/json" } });
  const payload = (await response.json()) as ApiResponse<HealthPayload>;
  if (!response.ok && payload.ok) {
    return {
      ok: false,
      error: { code: "HTTP_ERROR", message: `服务返回 ${response.status}` },
    };
  }
  return payload;
}
