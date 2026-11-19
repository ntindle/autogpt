"use client";

import { useMemo } from "react";
import {
  getGetV1ListExecutionSchedulesForAGraphQueryKey,
  useGetV1ListExecutionSchedulesForAGraph,
} from "@/app/api/__generated__/endpoints/schedules/schedules";
import { okData } from "@/app/api/helpers";
import { useSchedulerOutage } from "@/services/schedules/useSchedulerOutage";
import { useSchedulerRetryOptions } from "@/services/schedules/useSchedulerQueryOptions";
import {
  getTeamScopedQueryKey,
  getTenantRequestInit,
} from "@/components/contextual/TeamPicker/helpers";

export function useSelectedScheduleView(
  graphId: string,
  scheduleId: string,
  organizationId: string | null,
  teamId: string | null,
) {
  const schedulerRetryOptions = useSchedulerRetryOptions();
  const schedulesQuery = useGetV1ListExecutionSchedulesForAGraph(graphId, {
    query: {
      enabled: !!graphId,
      queryKey: getTeamScopedQueryKey(
        getGetV1ListExecutionSchedulesForAGraphQueryKey(graphId),
        organizationId,
        teamId,
      ),
      select: okData,
      ...schedulerRetryOptions,
    },
    request: getTenantRequestInit(organizationId, teamId),
  });
  const unavailable = useSchedulerOutage(schedulesQuery);

  const schedule = useMemo(
    () => schedulesQuery.data?.find((s) => s.id === scheduleId),
    [schedulesQuery.data, scheduleId],
  );

  const httpError =
    schedulesQuery.isSuccess && !schedule
      ? { status: 404, statusText: "Not found" }
      : undefined;

  return {
    schedule,
    unavailable,
    isLoading: schedulesQuery.isLoading && !unavailable,
    error: schedulesQuery.error || httpError,
  } as const;
}
