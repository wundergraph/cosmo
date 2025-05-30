import { OrganizationRole } from "@/lib/constants";
import { useCallback } from "react";
import { useUser } from "@/hooks/use-user";

/**
 * Returns a callback that can be uses to determine whether the authenticated users has at least one of the
 * required roles in the provided organization (or the current organization if none is provided).
 */
export function useCheckUserAccess() {
  const user = useUser();
  return useCallback(({ organizationId, rolesToBe }: {
    organizationId?: string;
    rolesToBe: OrganizationRole[];
  }) => {
    const org = organizationId
      ? user?.organizations.find((o) => o.id === organizationId)
      : user?.currentOrganization;

    if (!org?.groups) {
      return false;
    }

    if (!rolesToBe || rolesToBe.length === 0) {
      // We expect at least one role to be given, if no role is given, we don't need to perform any check
      return true;
    }

    const roles = new Set(org.groups.flatMap((g) => g.rules?.map((r) => r.role) ?? []));
    for (const role of rolesToBe) {
      if (roles.has(role)) {
        return true;
      }
    }

    return false;
  }, [user]);
}