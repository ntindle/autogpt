import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import { APP_SCHEME, FRONTEND_URL } from "@/lib/env";
import { workspaceFetch } from "@/lib/workspaceAccess";

export const authClient = createAuthClient({
  baseURL: FRONTEND_URL,
  fetchOptions: { customFetchImpl: workspaceFetch },
  plugins: [
    expoClient({
      scheme: APP_SCHEME,
      storagePrefix: APP_SCHEME,
      storage: SecureStore,
    }),
  ],
});
