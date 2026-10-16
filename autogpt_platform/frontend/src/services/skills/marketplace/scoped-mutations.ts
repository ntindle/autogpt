import * as api from "@/app/api/__generated__/endpoints/store/store";
import {
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function usePostV2PublishSkillToMarketplace<
  TError = api.PostV2PublishSkillToMarketplaceMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.usePostV2PublishSkillToMarketplace<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.usePostV2PublishSkillToMarketplace<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.usePostV2PublishSkillToMarketplace<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function usePutV2EditSkillSubmission<
  TError = api.PutV2EditSkillSubmissionMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.usePutV2EditSkillSubmission<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.usePutV2EditSkillSubmission<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.usePutV2EditSkillSubmission<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function usePostV2InstallMarketplaceSkill<
  TError = api.PostV2InstallMarketplaceSkillMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.usePostV2InstallMarketplaceSkill<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.usePostV2InstallMarketplaceSkill<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.usePostV2InstallMarketplaceSkill<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}
