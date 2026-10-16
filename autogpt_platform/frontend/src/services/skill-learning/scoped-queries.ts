import * as api from "@/app/api/__generated__/endpoints/skill-learning/skill-learning";
import {
  scopedResourceQuery,
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function useListSkillLearningDecisions<
  TData = Awaited<ReturnType<typeof api.listSkillLearningDecisions>>,
  TError = api.ListSkillLearningDecisionsQueryError,
>(
  options?: Parameters<
    typeof api.useListSkillLearningDecisions<TData, TError>
  >[0],
  queryClient?: Parameters<
    typeof api.useListSkillLearningDecisions<TData, TError>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListSkillLearningDecisions<TData, TError>(
    {
      ...options,
      query: scopedResourceQuery(
        api.getListSkillLearningDecisionsQueryKey(),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useListSkillLearningHistory<
  TData = Awaited<ReturnType<typeof api.listSkillLearningHistory>>,
  TError = api.ListSkillLearningHistoryQueryError,
>(
  params?: Parameters<typeof api.useListSkillLearningHistory<TData, TError>>[0],
  options?: Parameters<
    typeof api.useListSkillLearningHistory<TData, TError>
  >[1],
  queryClient?: Parameters<
    typeof api.useListSkillLearningHistory<TData, TError>
  >[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListSkillLearningHistory<TData, TError>(
    params,
    {
      ...options,
      query: scopedResourceQuery(
        api.getListSkillLearningHistoryQueryKey(params),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetSkillLearningDetail<
  TData = Awaited<ReturnType<typeof api.getSkillLearningDetail>>,
  TError = api.GetSkillLearningDetailQueryError,
>(
  name: Parameters<typeof api.useGetSkillLearningDetail<TData, TError>>[0],
  params?: Parameters<typeof api.useGetSkillLearningDetail<TData, TError>>[1],
  options?: Parameters<typeof api.useGetSkillLearningDetail<TData, TError>>[2],
  queryClient?: Parameters<
    typeof api.useGetSkillLearningDetail<TData, TError>
  >[3],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetSkillLearningDetail<TData, TError>(
    name,
    params,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetSkillLearningDetailQueryKey(name, params),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetSkillLearningStatus<
  TData = Awaited<ReturnType<typeof api.getSkillLearningStatus>>,
  TError = api.GetSkillLearningStatusQueryError,
>(
  params?: Parameters<typeof api.useGetSkillLearningStatus<TData, TError>>[0],
  options?: Parameters<typeof api.useGetSkillLearningStatus<TData, TError>>[1],
  queryClient?: Parameters<
    typeof api.useGetSkillLearningStatus<TData, TError>
  >[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetSkillLearningStatus<TData, TError>(
    params,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetSkillLearningStatusQueryKey(params),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}
