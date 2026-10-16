import * as api from "@/app/api/__generated__/endpoints/store/store";
import {
  scopedResourceQuery,
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function useGetV2ListMySkillSubmissions<
  TData = Awaited<ReturnType<typeof api.getV2ListMySkillSubmissions>>,
  TError = api.GetV2ListMySkillSubmissionsQueryError,
>(
  options?: Parameters<
    typeof api.useGetV2ListMySkillSubmissions<TData, TError>
  >[0],
  queryClient?: Parameters<
    typeof api.useGetV2ListMySkillSubmissions<TData, TError>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetV2ListMySkillSubmissions<TData, TError>(
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetV2ListMySkillSubmissionsQueryKey(),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}
