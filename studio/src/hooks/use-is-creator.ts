import { useUser } from "./use-user";

/**
 * Returns true if the current user is the creator of the current organization or the organization with the given id.
 * @param orgId
 * @returns {boolean}
 */
export const useIsCreator = (orgId?: string) => {
  const user = useUser();

  const org = orgId
    ? user?.organizations.find((org) => org.id === orgId)
    : user?.currentOrganization;

  return !!(org && user) && org.creatorUserId === user.id;
};
