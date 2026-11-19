import { bearer } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth";

export function nativeSessionBearer(allowWorkspaceAccessCookie = false) {
  const plugin = bearer({ requireSignature: true });
  return {
    ...plugin,
    async onRequest(request) {
      if (
        !allowWorkspaceAccessCookie ||
        request.headers.get("X-AutoGPT-Native") !== "1"
      )
        return;
      if (
        [
          "origin",
          "sec-fetch-mode",
          "sec-fetch-site",
          "sec-fetch-dest",
          "sec-fetch-user",
        ].some((name) => request.headers.has(name))
      )
        return;
      const cookie = request.headers.get("cookie");
      if (!cookie || !/^CF_Authorization=[^;\s]+$/.test(cookie.trim())) return;
      const headers = new Headers(request.headers);
      headers.delete("cookie");
      return { request: new Request(request, { headers }) };
    },
    hooks: {
      ...plugin.hooks,
      after: plugin.hooks.after.map((hook) => ({
        ...hook,
        matcher(context: Parameters<typeof hook.matcher>[0]) {
          const headers = context.request?.headers ?? context.headers;
          return Boolean(
            headers?.get("X-AutoGPT-Native") === "1" &&
              ![
                "origin",
                "cookie",
                "sec-fetch-mode",
                "sec-fetch-site",
                "sec-fetch-dest",
                "sec-fetch-user",
              ].some((header) => headers.has(header)) &&
              hook.matcher(context),
          );
        },
      })),
    },
  } satisfies BetterAuthPlugin;
}
