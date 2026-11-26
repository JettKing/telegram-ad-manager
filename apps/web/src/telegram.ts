export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
  contentSafeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
  ready: () => void;
  expand: () => void;
  onEvent?: (eventType: string, eventHandler: () => void) => void;
  offEvent?: (eventType: string, eventHandler: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Telegram?.WebApp;
}

export function initializeTelegramWebApp(): { available: boolean; initData: string } {
  const webApp = getTelegramWebApp();
  if (!webApp) return { available: false, initData: "" };
  webApp.ready();
  webApp.expand();
  if (typeof document === "undefined") return { available: true, initData: webApp.initData ?? "" };

  const root = document.documentElement;
  const syncViewport = () => {
    const height = webApp.viewportHeight || webApp.viewportStableHeight || window.visualViewport?.height || window.innerHeight;
    root.style.setProperty("--tg-viewport-height", `${height}px`);
    if (webApp.viewportStableHeight) root.style.setProperty("--tg-viewport-stable-height", `${webApp.viewportStableHeight}px`);

    const insets = webApp.contentSafeAreaInset ?? webApp.safeAreaInset;
    if (insets) {
      for (const side of ["top", "right", "bottom", "left"] as const) {
        root.style.setProperty(`--app-safe-area-${side}`, `${insets[side] ?? 0}px`);
      }
    }
  };
  syncViewport();
  webApp.onEvent?.("viewportChanged", syncViewport);
  webApp.onEvent?.("safeAreaChanged", syncViewport);
  webApp.onEvent?.("contentSafeAreaChanged", syncViewport);

  return { available: true, initData: webApp.initData ?? "" };
}

export function getTelegramInitData(): string {
  return getTelegramWebApp()?.initData?.trim() ?? "";
}
