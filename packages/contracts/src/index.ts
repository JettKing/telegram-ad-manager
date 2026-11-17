export type ServiceState = "configured" | "not_configured" | "unavailable";

export interface HealthPayload {
  ok: boolean;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  dependencies: {
    database: ServiceState;
    telegram: ServiceState;
    r2: ServiceState;
  };
}

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export interface ApiSuccessPayload<T> {
  ok: true;
  data: T;
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccessPayload<T> | ApiErrorPayload;

export type NavigationItem = {
  href: string;
  label: string;
  description: string;
  group: "运营" | "系统";
};
