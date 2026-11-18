import type { ApiResponse, HealthPayload } from "@tg-ad-manager/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "tg_ad_manager_session";
const CONTEXT_KEY = "tg_ad_manager_context";

export type SessionUser = {
  id: string;
  telegramUserId: string;
  displayName: string;
};

export type AuthData = {
  authenticated: boolean;
  user: SessionUser;
  tenant: { id: string; name: string };
  workspace: { id: string; name: string };
  role: string;
  session: { token: string; expiresAt: string };
};

export type Channel = { id: string; telegram_chat_id: string; username?: string; title: string; status: string; can_post: number; can_pin: number; can_delete: number };
export type Customer = { id: string; name: string; contact?: string; telegram_username?: string; status: string; total_spend_minor: number; updated_at: string };
export type Package = { id: string; name: string; description?: string; ad_type: string; publish_count: number; price_minor: number; is_enabled: number; is_public: number };
export type Order = { id: string; order_no: string; customer_id: string; channel_id: string; package_id: string; receivable_minor: number; payment_status: string; status: string; content_json: string; created_at: string; updated_at: string };
export type Schedule = { id: string; order_id: string; scheduled_at: string; status: string; created_at: string } & Record<string, unknown>;
export type PublishTask = { id: string; order_id: string; status: string; attempt_count: number; scheduled_at?: string; last_error?: string } & Record<string, unknown>;

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

function sessionToken(): string | null { return localStorage.getItem(SESSION_KEY); }
function telegramInitData(): string { return (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? ""; }

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = sessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.ok) {
    const error = payload.ok ? { code: "HTTP_ERROR", message: `服务返回 ${response.status}` } : payload.error;
    throw new ApiError(error.code, error.message, response.status);
  }
  return payload.data;
}

export async function getHealth(signal?: AbortSignal): Promise<ApiResponse<HealthPayload>> {
  const response = await fetch(`${API_BASE_URL}/api/v1/health`, { signal, headers: { Accept: "application/json" } });
  return await response.json() as ApiResponse<HealthPayload>;
}

export async function authenticate(): Promise<AuthData> {
  const token = sessionToken();
  if (token) {
    try { await request<Record<string, unknown>>("/api/v1/auth/me"); const saved = localStorage.getItem(CONTEXT_KEY); if (saved) return JSON.parse(saved) as AuthData; } catch { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(CONTEXT_KEY); }
  }
  const initData = telegramInitData();
  if (!initData) throw new ApiError("INIT_DATA_REQUIRED", "请从 Telegram Bot 的“进入广告管理”入口打开 Mini App", 400);
  const data = await request<AuthData>("/api/v1/auth/telegram", { method: "POST", body: JSON.stringify({ initData }), headers: { "X-Telegram-Init-Data": initData } });
  localStorage.setItem(SESSION_KEY, data.session.token);
  localStorage.setItem(CONTEXT_KEY, JSON.stringify(data));
  return data;
}

export function logout(): void { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(CONTEXT_KEY); }
export const getWorkspace = () => request<{ tenantId: string; workspaceId: string; role: string; permissions: string[] }>("/api/v1/workspace/context");
export const getChannels = () => request<{ channels: Channel[] }>("/api/v1/channels");
export const bindChannel = (chatId: string) => request<{ channelId: string; status: string; title: string; telegramChatId: string }>("/api/v1/channels/bind", { method: "POST", body: JSON.stringify({ chatId }) });
export const getCustomers = () => request<{ customers: Customer[] }>("/api/v1/customers");
export const createCustomer = (input: Record<string, unknown>) => request<{ customerId: string }>("/api/v1/customers", { method: "POST", body: JSON.stringify(input) });
export const getPackages = () => request<{ packages: Package[] }>("/api/v1/packages");
export const getOrders = () => request<{ orders: Order[] }>("/api/v1/orders");
export const getSchedules = () => request<{ schedules: Schedule[] }>("/api/v1/schedules");
export const getPublishTasks = () => request<{ tasks: PublishTask[] }>("/api/v1/publish-tasks");
export const getMedia = () => request<{ assets: Record<string, unknown>[] }>("/api/v1/media-assets");
