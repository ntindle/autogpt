import * as api from "@/app/api/__generated__/endpoints/skill-learning/skill-learning";
import {
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function useUpdateExpertLearningPolicy<
  TError = api.UpdateExpertLearningPolicyMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useUpdateExpertLearningPolicy<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useUpdateExpertLearningPolicy<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUpdateExpertLearningPolicy<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useRunSkillLearningNow<
  TError = api.RunSkillLearningNowMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useRunSkillLearningNow<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useRunSkillLearningNow<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useRunSkillLearningNow<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useDecideSkillLearningProposal<
  TError = api.DecideSkillLearningProposalMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useDecideSkillLearningProposal<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useDecideSkillLearningProposal<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useDecideSkillLearningProposal<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useEditLearnedSkill<
  TError = api.EditLearnedSkillMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useEditLearnedSkill<TError, TContext>>[0],
  queryClient?: Parameters<typeof api.useEditLearnedSkill<TError, TContext>>[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useEditLearnedSkill<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useReportSkillOutcome<
  TError = api.ReportSkillOutcomeMutationError,
  TContext = unknown,
>(
  options?: Parameters<typeof api.useReportSkillOutcome<TError, TContext>>[0],
  queryClient?: Parameters<
    typeof api.useReportSkillOutcome<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useReportSkillOutcome<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useUpdateSkillLearningPolicy<
  TError = api.UpdateSkillLearningPolicyMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useUpdateSkillLearningPolicy<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useUpdateSkillLearningPolicy<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useUpdateSkillLearningPolicy<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useRestoreLearnedSkillVersion<
  TError = api.RestoreLearnedSkillVersionMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useRestoreLearnedSkillVersion<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useRestoreLearnedSkillVersion<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useRestoreLearnedSkillVersion<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}

export function useExcludeSkillLearningSource<
  TError = api.ExcludeSkillLearningSourceMutationError,
  TContext = unknown,
>(
  options?: Parameters<
    typeof api.useExcludeSkillLearningSource<TError, TContext>
  >[0],
  queryClient?: Parameters<
    typeof api.useExcludeSkillLearningSource<TError, TContext>
  >[1],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useExcludeSkillLearningSource<TError, TContext>(
    { ...options, request: pinnedResourceRequest(resolved, options?.request) },
    queryClient,
  );
}
