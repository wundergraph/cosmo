import { useUser } from "./use-user";

/**
 * Returns the roles of the current user for the current organization or the organization with the given id.
 * @param orgId
 * @returns {string[]}
 */
export const useRoles = (orgId?: string) => {
  const user = useUser();

  if (!orgId) {
    return user?.currentOrganization.roles || [];
  }

  return !!user?.organizations.find((org) => org.id === orgId)?.roles || [];
};
