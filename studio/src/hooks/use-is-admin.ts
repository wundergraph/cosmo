import { useUser } from "./use-user";

/**
 * Returns true if the current user is an admin of the current organization or the organization with the given id.
 * @param orgId
 * @returns {boolean}
 */
export const useIsAdmin = (orgId?: string) => {
  const user = useUser();

  if (!orgId) {
    return user?.currentOrganization.roles.includes("admin");
  }

  return !!user?.organizations
    .find((org) => org.id === orgId)
    ?.roles.includes("admin");
};
