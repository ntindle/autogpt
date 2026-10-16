import * as api from "@/app/api/__generated__/endpoints/skills/skills";
import {
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function useUploadCopilotSkill<
  TError = api.UploadCopilotSkillMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useUploadCopilotSkill<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useUploadCopilotSkill<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUploadCopilotSkill<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useUploadCopilotSkillPackage<
  TError = api.UploadCopilotSkillPackageMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useUploadCopilotSkillPackage<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useUploadCopilotSkillPackage<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUploadCopilotSkillPackage<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useDeleteCopilotSkill<
  TError = api.DeleteCopilotSkillMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useDeleteCopilotSkill<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useDeleteCopilotSkill<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useDeleteCopilotSkill<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}
