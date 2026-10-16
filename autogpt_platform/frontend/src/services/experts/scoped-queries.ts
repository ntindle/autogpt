import * as api from "@/app/api/__generated__/endpoints/experts/experts";
import {
  scopedResourceQuery,
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function useListExperts<
  TData = Awaited<ReturnType<typeof api.listExperts>>,
  TError = api.ListExpertsQueryError,
>(
  options?: Parameters<typeof api.useListExperts<TData, TError>>[0],
  queryClient?: Parameters<typeof api.useListExperts<TData, TError>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListExperts<TData, TError>(
    {
      ...options,
      query: scopedResourceQuery(
        api.getListExpertsQueryKey(),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetExpertAvatarGeneration<
  TData = Awaited<ReturnType<typeof api.getExpertAvatarGeneration>>,
  TError = api.GetExpertAvatarGenerationQueryError,
>(
  jobId: Parameters<typeof api.useGetExpertAvatarGeneration<TData, TError>>[0],
  options?: Parameters<
    typeof api.useGetExpertAvatarGeneration<TData, TError>
  >[1],
  queryClient?: Parameters<
    typeof api.useGetExpertAvatarGeneration<TData, TError>
  >[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetExpertAvatarGeneration<TData, TError>(
    jobId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetExpertAvatarGenerationQueryKey(jobId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useListExpertIdentities<
  TData = Awaited<ReturnType<typeof api.listExpertIdentities>>,
  TError = api.ListExpertIdentitiesQueryError,
>(
  options?: Parameters<typeof api.useListExpertIdentities<TData, TError>>[0],
  queryClient?: Parameters<
    typeof api.useListExpertIdentities<TData, TError>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListExpertIdentities<TData, TError>(
    {
      ...options,
      query: scopedResourceQuery(
        api.getListExpertIdentitiesQueryKey(),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useListExpertPods<
  TData = Awaited<ReturnType<typeof api.listExpertPods>>,
  TError = api.ListExpertPodsQueryError,
>(
  options?: Parameters<typeof api.useListExpertPods<TData, TError>>[0],
  queryClient?: Parameters<typeof api.useListExpertPods<TData, TError>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListExpertPods<TData, TError>(
    {
      ...options,
      query: scopedResourceQuery(
        api.getListExpertPodsQueryKey(),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useListExpertSetupItems<
  TData = Awaited<ReturnType<typeof api.listExpertSetupItems>>,
  TError = api.ListExpertSetupItemsQueryError,
>(
  options?: Parameters<typeof api.useListExpertSetupItems<TData, TError>>[0],
  queryClient?: Parameters<
    typeof api.useListExpertSetupItems<TData, TError>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListExpertSetupItems<TData, TError>(
    {
      ...options,
      query: scopedResourceQuery(
        api.getListExpertSetupItemsQueryKey(),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetExpert<
  TData = Awaited<ReturnType<typeof api.getExpert>>,
  TError = api.GetExpertQueryError,
>(
  expertId: Parameters<typeof api.useGetExpert<TData, TError>>[0],
  options?: Parameters<typeof api.useGetExpert<TData, TError>>[1],
  queryClient?: Parameters<typeof api.useGetExpert<TData, TError>>[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetExpert<TData, TError>(
    expertId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetExpertQueryKey(expertId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetExpertActivity<
  TData = Awaited<ReturnType<typeof api.getExpertActivity>>,
  TError = api.GetExpertActivityQueryError,
>(
  expertId: Parameters<typeof api.useGetExpertActivity<TData, TError>>[0],
  options?: Parameters<typeof api.useGetExpertActivity<TData, TError>>[1],
  queryClient?: Parameters<typeof api.useGetExpertActivity<TData, TError>>[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetExpertActivity<TData, TError>(
    expertId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetExpertActivityQueryKey(expertId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetV2GetExpertComputer<
  TData = Awaited<ReturnType<typeof api.getV2GetExpertComputer>>,
  TError = api.GetV2GetExpertComputerQueryError,
>(
  expertId: Parameters<typeof api.useGetV2GetExpertComputer<TData, TError>>[0],
  options?: Parameters<typeof api.useGetV2GetExpertComputer<TData, TError>>[1],
  queryClient?: Parameters<
    typeof api.useGetV2GetExpertComputer<TData, TError>
  >[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetV2GetExpertComputer<TData, TError>(
    expertId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetV2GetExpertComputerQueryKey(expertId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useListExpertCredentials<
  TData = Awaited<ReturnType<typeof api.listExpertCredentials>>,
  TError = api.ListExpertCredentialsQueryError,
>(
  expertId: Parameters<typeof api.useListExpertCredentials<TData, TError>>[0],
  options?: Parameters<typeof api.useListExpertCredentials<TData, TError>>[1],
  queryClient?: Parameters<
    typeof api.useListExpertCredentials<TData, TError>
  >[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListExpertCredentials<TData, TError>(
    expertId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getListExpertCredentialsQueryKey(expertId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetExpertDetachPreview<
  TData = Awaited<ReturnType<typeof api.getExpertDetachPreview>>,
  TError = api.GetExpertDetachPreviewQueryError,
>(
  expertId: Parameters<typeof api.useGetExpertDetachPreview<TData, TError>>[0],
  options?: Parameters<typeof api.useGetExpertDetachPreview<TData, TError>>[1],
  queryClient?: Parameters<
    typeof api.useGetExpertDetachPreview<TData, TError>
  >[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetExpertDetachPreview<TData, TError>(
    expertId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetExpertDetachPreviewQueryKey(expertId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useGetExpertOnboarding<
  TData = Awaited<ReturnType<typeof api.getExpertOnboarding>>,
  TError = api.GetExpertOnboardingQueryError,
>(
  expertId: Parameters<typeof api.useGetExpertOnboarding<TData, TError>>[0],
  options?: Parameters<typeof api.useGetExpertOnboarding<TData, TError>>[1],
  queryClient?: Parameters<typeof api.useGetExpertOnboarding<TData, TError>>[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGetExpertOnboarding<TData, TError>(
    expertId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getGetExpertOnboardingQueryKey(expertId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useListExpertRuns<
  TData = Awaited<ReturnType<typeof api.listExpertRuns>>,
  TError = api.ListExpertRunsQueryError,
>(
  expertId: Parameters<typeof api.useListExpertRuns<TData, TError>>[0],
  options?: Parameters<typeof api.useListExpertRuns<TData, TError>>[1],
  queryClient?: Parameters<typeof api.useListExpertRuns<TData, TError>>[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListExpertRuns<TData, TError>(
    expertId,
    {
      ...options,
      query: scopedResourceQuery(
        api.getListExpertRunsQueryKey(expertId),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}
