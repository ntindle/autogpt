import { FRONTEND_URL } from "@/lib/env";

export function settingsCookies(cookieHeader: string, frontendURL: string) {
  const { protocol } = new URL(frontendURL);
  return cookieHeader
    .split(";")
    .map((pair) => pair.trim())
    .flatMap((pair) => {
      const split = pair.indexOf("=");
      if (split <= 0) return [];
      const name = pair.slice(0, split).trim();
      const value = pair.slice(split + 1).trim();
      if (!name) return [];
      return [
        {
          name,
          value,
          path: "/",
          secure: protocol === "https:",
          httpOnly: true,
        },
      ];
    });
}

export function isAllowedSettingsURL(url: string) {
  if (!isFrontendOrigin(url)) return false;
  const { pathname } = new URL(url);
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function isFrontendOrigin(url: string) {
  try {
    return new URL(url).origin === new URL(FRONTEND_URL).origin;
  } catch {
    return false;
  }
}

export function isWebURL(url: string) {
  return /^https?:\/\//i.test(url);
}
