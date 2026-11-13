import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import CookieManager from "@preeternal/react-native-cookie-manager";
import type { WebView } from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";

import { authClient } from "@/lib/auth/client";
import { FRONTEND_URL } from "@/lib/env";

import {
  settingsCookies,
  isAllowedSettingsURL,
  isFrontendOrigin,
  isWebURL,
} from "./helpers";

export function useSettingsScreen() {
  const cookie = useQuery({
    queryKey: ["auth", "cookie"],
    queryFn: async () => {
      const cookies = settingsCookies(
        await authClient.getCookie(),
        FRONTEND_URL,
      );
      await Promise.all(
        cookies.map(async (value) => {
          await CookieManager.set(FRONTEND_URL, value);
          if (Platform.OS === "ios")
            await CookieManager.set(FRONTEND_URL, value, {
              iosCookieStore: "webKit",
            });
        }),
      );
      return true;
    },
    staleTime: 0,
    gcTime: 0,
  });
  const webViewRef = useRef<WebView<object>>(null);
  // One page change can report several states; go back only once for it.
  const isGoingBack = useRef(false);
  const hasShownSettings = useRef(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

  function handleNavigation(request: ShouldStartLoadRequest) {
    const { url } = request;
    if (url === "about:blank") return true;
    // iOS also asks about iframes (payment forms and the like); they load in
    // place and must never send the person to the browser.
    if (request.isTopFrame === false) return isWebURL(url);
    if (isAllowedSettingsURL(url)) return true;
    if (isWebURL(url) && !isFrontendOrigin(url)) {
      Linking.openURL(url).catch(() => undefined);
    } else if (isFrontendOrigin(url) && !hasShownSettings.current) {
      setIsBlocked(true);
    }
    return false;
  }

  // Next.js links change the page with pushState, which never reaches
  // handleNavigation, so a page outside Settings is undone here instead.
  function handleStateChange({ url, canGoBack, loading }: WebViewNavigation) {
    if (url === "about:blank") {
      isGoingBack.current = false;
      return;
    }
    if (isAllowedSettingsURL(url)) {
      isGoingBack.current = false;
      // Load start reports the URL too, before a redirect away from it.
      if (!loading) hasShownSettings.current = true;
      return;
    }
    if (!canGoBack) {
      setIsBlocked(true);
      return;
    }
    if (isGoingBack.current) return;
    isGoingBack.current = true;
    webViewRef.current?.goBack();
  }

  function retry() {
    setIsBlocked(false);
    hasShownSettings.current = false;
    setWebViewKey((key) => key + 1);
    void cookie.refetch();
  }

  return {
    settingsURL: `${FRONTEND_URL}/settings`,
    cookiesReady: cookie.data === true,
    isError: cookie.isError,
    isBlocked,
    webViewKey,
    retry,
    webViewRef,
    handleNavigation,
    handleStateChange,
  };
}
