import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../apps/web/src/lib/api";
import { initializeTelegramWebApp } from "../apps/web/src/telegram";

const session = {
  id: "session-1",
  token: "signed-session-token",
  expiresAt: "2026-11-20T00:00:00.000Z",
};
const authData = {
  authenticated: true,
  user: { id: "user-1", telegramUserId: "8600658922", displayName: "测试用户" },
  tenant: { id: "tenant-1", name: "测试租户" },
  workspace: { id: "workspace-1", name: "测试工作空间" },
  role: "owner",
  session,
};

function installBrowser(initData = "query_id=AAHtest&user=%7B%22id%22%3A1%7D&hash=test") {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const ready = vi.fn();
  const expand = vi.fn();
  vi.stubGlobal("window", { Telegram: { WebApp: { initData, ready, expand } } });
  return { ready, expand };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Telegram Mini App local auth integration", () => {
  it("initializes the official WebApp bridge before authentication", () => {
    const { ready, expand } = installBrowser();
    const result = initializeTelegramWebApp();
    expect(result).toEqual({ available: true, initData: expect.stringContaining("hash=test") });
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });

  it("sends SDK initData in the auth request and stores the signed session", async () => {
    installBrowser();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toBeDefined();
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Telegram-Init-Data")).toContain("hash=test");
      expect(JSON.parse(String(init?.body))).toEqual({ initData: expect.stringContaining("hash=test") });
      return new Response(JSON.stringify({ ok: true, data: authData }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await authenticate();
    expect(result.session.token).toBe("signed-session-token");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(localStorage.getItem("tg_ad_manager_session")).toBe("signed-session-token");
  });

  it("rejects local browser access without Telegram initData", async () => {
    installBrowser("");
    await expect(authenticate()).rejects.toMatchObject({ code: "INIT_DATA_REQUIRED" });
  });
});
