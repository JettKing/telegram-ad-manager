export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  ready: () => void;
  expand: () => void;
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
  return { available: true, initData: webApp.initData ?? "" };
}

export function getTelegramInitData(): string {
  return getTelegramWebApp()?.initData?.trim() ?? "";
}
