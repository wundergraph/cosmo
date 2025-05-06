import { OrganizationRole } from "@/lib/constants";
import { useCallback } from "react";
import { useUser } from "@/hooks/use-user";

export function useCheckUserAccess() {
  const user = useUser();
  return useCallback(({ organizationId, rolesToBe }: {
    organizationId?: string;
    rolesToBe: OrganizationRole[];
  }) => {
    const org = organizationId
      ? user?.organizations.find((o) => o.id === organizationId)
      : user?.currentOrganization;

    if (!org) {
      return false;
    }

    const roles = org.groups.flatMap((g) => g.rules.map((r) => r.role));
    for (const role of rolesToBe) {
      if (roles.includes(role)) {
        return true;
      }
    }

    return false;
  }, [user]);
}