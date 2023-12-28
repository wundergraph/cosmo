import { useQuery } from "@tanstack/react-query";
import { useCurrentOrganization } from "./use-current-organization";
import { getBillingPlans } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useMemo } from "react";

export const useCurrentPlan = () => {
  const org = useCurrentOrganization();

  const { data } = useQuery({
    ...getBillingPlans.useQuery(),
  });

  return useMemo(
    () =>
      data?.plans.find(({ id }) => id === org?.billing?.plan) || data?.plans[0],
    [data?.plans, org?.billing?.plan],
  );
};
