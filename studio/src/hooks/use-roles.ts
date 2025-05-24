import { useUser } from "./use-user";
import { useMemo } from "react";

/**
 * Returns the roles of the current user for the current organization or the organization with the given id.
 * @param orgId
 * @returns {string[]}
 */
export const useRoles = (orgId?: string) => {
  const user = useUser();
  return useMemo(() => {
    const org = orgId
      ? user?.organizations.find((o) => o.id === orgId)
      : user?.currentOrganization;

    return org?.groups.flatMap((g) => g.rules.map((r) => r.role)) ?? [];
  }, [user, orgId]);
};
