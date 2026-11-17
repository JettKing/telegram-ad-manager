import type { ApiResponse, HealthPayload } from "@tg-ad-manager/contracts";

export async function getHealth(signal?: AbortSignal): Promise<ApiResponse<HealthPayload>> {
  const response = await fetch("/api/v1/health", { signal, headers: { Accept: "application/json" } });
  const payload = (await response.json()) as ApiResponse<HealthPayload>;
  if (!response.ok && payload.ok) {
    return {
      ok: false,
      error: { code: "HTTP_ERROR", message: `服务返回 ${response.status}` },
    };
  }
  return payload;
}
