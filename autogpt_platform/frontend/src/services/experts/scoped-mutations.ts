import * as api from "@/app/api/__generated__/endpoints/experts/experts";
import {
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function useUpdateExpertMode<
  TError = api.UpdateExpertModeMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useUpdateExpertMode<TError, TContext>>[0],
  queryClient?: Parameters<typeof api.useUpdateExpertMode<TError, TContext>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUpdateExpertMode<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useHireExpert<
  TError = api.HireExpertMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useHireExpert<TError, TContext>>[0],
  queryClient?: Parameters<typeof api.useHireExpert<TError, TContext>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useHireExpert<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useGenerateExpertAvatar<
  TError = api.GenerateExpertAvatarMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useGenerateExpertAvatar<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useGenerateExpertAvatar<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGenerateExpertAvatar<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useCreateExpertPod<
  TError = api.CreateExpertPodMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useCreateExpertPod<TError, TContext>>[0],
  queryClient?: Parameters<typeof api.useCreateExpertPod<TError, TContext>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useCreateExpertPod<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useCreateRaisedExpert<
  TError = api.CreateRaisedExpertMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useCreateRaisedExpert<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useCreateRaisedExpert<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useCreateRaisedExpert<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useArchiveExpert<
  TError = api.ArchiveExpertMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useArchiveExpert<TError, TContext>>[0],
  queryClient?: Parameters<typeof api.useArchiveExpert<TError, TContext>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useArchiveExpert<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useUpdateExpertAvatar<
  TError = api.UpdateExpertAvatarMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useUpdateExpertAvatar<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useUpdateExpertAvatar<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUpdateExpertAvatar<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useUpdateExpertBudget<
  TError = api.UpdateExpertBudgetMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useUpdateExpertBudget<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useUpdateExpertBudget<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUpdateExpertBudget<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function usePostV2StartExpertDesktop<
  TError = api.PostV2StartExpertDesktopMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.usePostV2StartExpertDesktop<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.usePostV2StartExpertDesktop<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.usePostV2StartExpertDesktop<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useGrantExpertCredentials<
  TError = api.GrantExpertCredentialsMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useGrantExpertCredentials<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useGrantExpertCredentials<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useGrantExpertCredentials<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useRevokeExpertCredential<
  TError = api.RevokeExpertCredentialMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useRevokeExpertCredential<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useRevokeExpertCredential<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useRevokeExpertCredential<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useAssignExpertPod<
  TError = api.AssignExpertPodMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useAssignExpertPod<TError, TContext>>[0],
  queryClient?: Parameters<typeof api.useAssignExpertPod<TError, TContext>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useAssignExpertPod<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useResumeExpertSchedules<
  TError = api.ResumeExpertSchedulesMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useResumeExpertSchedules<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useResumeExpertSchedules<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useResumeExpertSchedules<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useUpdateExpertSkills<
  TError = api.UpdateExpertSkillsMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useUpdateExpertSkills<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useUpdateExpertSkills<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUpdateExpertSkills<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useUpdateExpertSoul<
  TError = api.UpdateExpertSoulMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useUpdateExpertSoul<TError, TContext>>[0],
  queryClient?: Parameters<typeof api.useUpdateExpertSoul<TError, TContext>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUpdateExpertSoul<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useInstallExpertWorkflow<
  TError = api.InstallExpertWorkflowMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useInstallExpertWorkflow<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useInstallExpertWorkflow<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useInstallExpertWorkflow<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useRemoveExpertWorkflow<
  TError = api.RemoveExpertWorkflowMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useRemoveExpertWorkflow<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useRemoveExpertWorkflow<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useRemoveExpertWorkflow<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}
