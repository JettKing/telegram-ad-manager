import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, authenticate, downloadPaymentProof, logout, openMediaPreview, request, type AuthData } from "../apps/web/src/lib/api";

const SESSION_KEY = "tg_ad_manager_session";
const CONTEXT_KEY = "tg_ad_manager_context";
const cachedAuth: AuthData = {
  authenticated: true,
  user: { id: "user-1", telegramUserId: "123", displayName: "Alice" },
  tenant: { id: "tenant-1", name: "Tenant" },
  workspace: { id: "workspace-1", name: "Workspace" },
  role: "owner",
  permissions: ["finance:read", "workspace:manage"],
  session: { token: "old-token", expiresAt: "2027-01-01T00:00:00.000Z" },
};

function installStorage(values: Record<string, string> = {}) {
  const store = new Map(Object.entries(values));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  return store;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web API authentication cache", () => {
  it("uses the current role returned by /auth/me instead of a cached role or permissions", async () => {
    const store = installStorage({
      [SESSION_KEY]: "current-token",
      [CONTEXT_KEY]: JSON.stringify(cachedAuth),
    });
    let requestedUrl: RequestInfo | URL | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = input;
      return jsonResponse({
      authenticated: true,
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      role: "viewer",
      expiresAt: "2027-02-01T00:00:00.000Z",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await authenticate();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(requestedUrl)).toContain("/api/v1/auth/me");
    expect(result.role).toBe("viewer");
    expect(result.session.token).toBe("current-token");
    expect(result.session.expiresAt).toBe("2027-02-01T00:00:00.000Z");
    expect(result.permissions).toBeUndefined();
    expect(JSON.parse(store.get(CONTEXT_KEY)!).role).toBe("viewer");
    expect(JSON.parse(store.get(CONTEXT_KEY)!).permissions).toBeUndefined();
  });

  it("accepts permissions from /auth/me when the server provides them", async () => {
    installStorage({ [SESSION_KEY]: "current-token", [CONTEXT_KEY]: JSON.stringify(cachedAuth) });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ authenticated: true, role: "finance", permissions: ["finance:read"] })));

    const result = await authenticate();

    expect(result.role).toBe("finance");
    expect(result.permissions).toEqual(["finance:read"]);
  });

  it("preserves a valid session and cached context when /auth/me fails transiently", async () => {
    const store = installStorage({ [SESSION_KEY]: "valid-token", [CONTEXT_KEY]: JSON.stringify(cachedAuth) });
    const fetchMock = vi.fn(async () => jsonResponse({ code: "TEMPORARY_FAILURE", message: "try again" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authenticate()).rejects.toMatchObject({ status: 503 });

    expect(store.get(SESSION_KEY)).toBe("valid-token");
    expect(store.get(CONTEXT_KEY)).toBe(JSON.stringify(cachedAuth));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("clears both session and cached context on a 401, even when its response is not JSON", async () => {
    const store = installStorage({ [SESSION_KEY]: "expired-token", [CONTEXT_KEY]: JSON.stringify(cachedAuth) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));

    await expect(request("/api/v1/private")).rejects.toBeInstanceOf(ApiError);

    expect(store.has(SESSION_KEY)).toBe(false);
    expect(store.has(CONTEXT_KEY)).toBe(false);
  });

  it("clears local credentials on logout even if the server returns an error", async () => {
    const store = installStorage({ [SESSION_KEY]: "current-token", [CONTEXT_KEY]: JSON.stringify(cachedAuth) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "LOGOUT_FAILED", message: "offline" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })));

    await expect(logout()).rejects.toMatchObject({ code: "LOGOUT_FAILED", status: 503 });

    expect(store.has(SESSION_KEY)).toBe(false);
    expect(store.has(CONTEXT_KEY)).toBe(false);
  });

  it("clears credentials on 401 responses from binary/media requests too", async () => {
    const store = installStorage({ [SESSION_KEY]: "expired-token", [CONTEXT_KEY]: JSON.stringify(cachedAuth) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "expired" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })));

    await expect(downloadPaymentProof("proof-1")).rejects.toMatchObject({ status: 401 });
    expect(store.has(SESSION_KEY)).toBe(false);
    expect(store.has(CONTEXT_KEY)).toBe(false);

    store.set(SESSION_KEY, "expired-token");
    store.set(CONTEXT_KEY, JSON.stringify(cachedAuth));
    await expect(openMediaPreview("asset-1")).rejects.toMatchObject({ status: 401 });
    expect(store.has(SESSION_KEY)).toBe(false);
    expect(store.has(CONTEXT_KEY)).toBe(false);
  });
});
