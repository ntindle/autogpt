import * as api from "@/app/api/__generated__/endpoints/skills/skills";
import {
  scopedResourceQuery,
  pinnedResourceRequest,
  usePrivateResourceScope,
  type PrivateResourceScope,
} from "@/services/org-team/private-resource-scope";

export function useListCopilotSkills<
  TData = Awaited<ReturnType<typeof api.listCopilotSkills>>,
  TError = api.ListCopilotSkillsQueryError,
>(
  params?: Parameters<typeof api.useListCopilotSkills<TData, TError>>[0],
  options?: Parameters<typeof api.useListCopilotSkills<TData, TError>>[1],
  queryClient?: Parameters<typeof api.useListCopilotSkills<TData, TError>>[2],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useListCopilotSkills<TData, TError>(
    params,
    {
      ...options,
      query: scopedResourceQuery(
        api.getListCopilotSkillsQueryKey(params),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useReadCopilotSkill<
  TData = Awaited<ReturnType<typeof api.readCopilotSkill>>,
  TError = api.ReadCopilotSkillQueryError,
>(
  name: Parameters<typeof api.useReadCopilotSkill<TData, TError>>[0],
  params?: Parameters<typeof api.useReadCopilotSkill<TData, TError>>[1],
  options?: Parameters<typeof api.useReadCopilotSkill<TData, TError>>[2],
  queryClient?: Parameters<typeof api.useReadCopilotSkill<TData, TError>>[3],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useReadCopilotSkill<TData, TError>(
    name,
    params,
    {
      ...options,
      query: scopedResourceQuery(
        api.getReadCopilotSkillQueryKey(name, params),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}

export function useDownloadCopilotSkillPackage<
  TData = Awaited<ReturnType<typeof api.downloadCopilotSkillPackage>>,
  TError = api.DownloadCopilotSkillPackageQueryError,
>(
  name: Parameters<typeof api.useDownloadCopilotSkillPackage<TData, TError>>[0],
  params?: Parameters<
    typeof api.useDownloadCopilotSkillPackage<TData, TError>
  >[1],
  options?: Parameters<
    typeof api.useDownloadCopilotSkillPackage<TData, TError>
  >[2],
  queryClient?: Parameters<
    typeof api.useDownloadCopilotSkillPackage<TData, TError>
  >[3],
  scope?: PrivateResourceScope,
) {
  const resolved = usePrivateResourceScope(scope);
  return api.useDownloadCopilotSkillPackage<TData, TError>(
    name,
    params,
    {
      ...options,
      query: scopedResourceQuery(
        api.getDownloadCopilotSkillPackageQueryKey(name, params),
        resolved,
        options?.query,
      ),
      request: pinnedResourceRequest(resolved, options?.request),
    },
    queryClient,
  );
}
