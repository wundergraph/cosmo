import { useCheckUserAccess } from "@/hooks/use-check-user-access";

/**
 * Returns true if the current user is an admin of the current organization or the organization with the given id.
 * @param orgId
 * @returns {boolean}
 */
export const useIsAdmin = (orgId?: string) => {
  const checkUserAccess = useCheckUserAccess();

  return checkUserAccess({
    organizationId: orgId,
    rolesToBe: ["organization-admin"],
  });
};
