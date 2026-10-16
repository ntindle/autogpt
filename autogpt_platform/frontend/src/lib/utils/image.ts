import { isLocalStoreMediaUrl } from "@/lib/store-media";

export function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("/") || isLocalStoreMediaUrl(src);
}
