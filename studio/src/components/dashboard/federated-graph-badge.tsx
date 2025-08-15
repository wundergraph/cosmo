import { useCurrentOrganization } from "@/hooks/use-current-organization";
import * as React from "react";
import { Link } from "@/components/ui/link";
import { WorkspaceFederatedGraph } from "@/components/dashboard/workspace-provider";

export interface FederatedGraphBadgeProps {
  graph: WorkspaceFederatedGraph['graph'];
}

export function FederatedGraphBadge({ graph }: FederatedGraphBadgeProps) {
  const currentOrg = useCurrentOrganization();

  return (
    <Link
      href={`/${currentOrg?.slug}/${graph.namespace}/graph/${graph.name}`}
      className="bg-accent/15 hover:bg-accent/30 text-accent-foreground transition-colors duration-150 px-3 py-1 rounded-lg text-sm flex-shrink-0 max-w-[180px] lg:max-w-sm truncate"
    >
      {graph.name}
    </Link>
  );
}