import { useUser } from "./use-user";

/**
 * Returns true if the current user has the given feature enabled for the current organization or the organization with the given id.
 * @param feature
 * @param orgId
 * @returns {boolean}
 */
export const useHas = (feature: string, orgId?: string) => {
  const user = useUser();

  const org = orgId
    ? user?.organizations.find((org) => org.id === orgId)
    : user?.currentOrganization;

  return org?.features?.includes(feature);
};
