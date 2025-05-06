import { useMemo } from "react";
import { useUser } from "./use-user";

/**
 * Returns a feature for the current organization or the organization with the given id.
 * @param feature The feature id
 * @param orgId Optional organization id, defaults to the current organization
 * @returns The feature or undefined
 */
export const useFeature = (feature: string, orgId?: string) => {
  const user = useUser();

  return useMemo(() => {
    const org = orgId
      ? user?.organizations.find((org) => org.id === orgId)
      : user?.currentOrganization;

    return org?.features.find(({ id }) => id === feature);
  }, [feature, orgId, user?.currentOrganization, user?.organizations]);
};
