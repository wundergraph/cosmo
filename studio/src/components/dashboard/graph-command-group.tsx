import * as React from "react";
import { WorkspaceNamespace } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CheckIcon } from "@radix-ui/react-icons";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

type GraphCommandGroupProps = {
  isFiltering: boolean;
  namespace: WorkspaceNamespace;
  namespaceIndex: number;
  activeGraphId?: string;
  activeSubgraphId?: string;
  setNamespace(namespace: string): void;
}

export function GraphCommandGroup({
  isFiltering,
  namespace,
  namespaceIndex,
  activeGraphId,
  activeSubgraphId,
  setNamespace,
}: GraphCommandGroupProps) {
  return (
    <CommandGroup key={`heading-${namespaceIndex}`} heading={namespace.name}>
      {namespace.graphs.map(({ subgraphs, ...graph }, graphIndex) => (
        <React.Fragment key={`graph-${namespaceIndex}-${graphIndex}`}>
          <GraphCommandItem
            namespace={namespace}
            name={graph.name}
            isContract={graph.isContract}
            isActive={activeGraphId === graph.id}
            value={`${namespace.name}.${graph.id}`}
            setNamespace={setNamespace}
          />

          {(isFiltering || activeSubgraphId) && subgraphs.map((subgraph, subgraphIndex) => (
            <GraphCommandItem
              key={`subgraph-${namespaceIndex}-${graphIndex}-${subgraphIndex}`}
              name={subgraph.name}
              namespace={namespace}
              isActive={activeSubgraphId === subgraph.id}
              value={`${namespace.name}.${graph.id}.${subgraph.id}`}
              isSubgraph
              className="pl-8"
              setNamespace={setNamespace}
            />
          ))}
        </React.Fragment>
      ))}
    </CommandGroup>
  );
}

interface GraphLinkProps {
  name: string;
  namespace: WorkspaceNamespace;
  value: string;
  isSubgraph?: boolean;
  isContract?: boolean;
  isActive: boolean;
  className?: string;
  setNamespace(namespace: string): void;
}

const defaultGraphTemplate = `/[organizationSlug]/[namespace]/graph/[slug]`;
const graphAreasWithParameters: readonly string[] = [
  'change-log',
  'checks',
  'compositions',
  'feature-flags',
  'proposals'
];

function GraphCommandItem({
  name,
  namespace,
  value,
  isSubgraph = false,
  isContract = false,
  isActive,
  className,
  setNamespace,
}: GraphLinkProps) {
  const router = useRouter();
  const organizationSlug = useCurrentOrganization()?.slug;

  const pathname = useMemo(
    () => {
      const segmentSplit = router.pathname.split('/');
      const segment = segmentSplit[3]?.toLowerCase();
      if (isSubgraph) {
        return segment === 'subgraph'
          ? router.pathname
          : `/[organizationSlug]/[namespace]/subgraph/[subgraphSlug]`;
      }

      if (segment !== 'graph') {
        return defaultGraphTemplate;
      }

      const areaSegment = segmentSplit[5]?.toLowerCase();
      return areaSegment && graphAreasWithParameters.includes(areaSegment) && segmentSplit.length > 5
        ? `${defaultGraphTemplate}/${areaSegment}`
        : router.pathname;
    },
    [router.pathname, isSubgraph],
  );

  return (
    <CommandItem
      key={`graph-${namespace.name}-${name}`}
      className={cn(
        "cursor-pointer pl-4 gap-2 justify-between w-full",
        className
      )}
      value={value}
      onSelect={() => {
        setNamespace(namespace.name);
        router.push({
          pathname,
          query: {
            organizationSlug,
            namespace: namespace.name,
            ...(isSubgraph ? { subgraphSlug: name } : { slug: name }),
          }
        });
      }}
    >
      <span className="flex justify-between items-center gap-2 w-full">
        {name}
        {!isSubgraph && isContract && (
          <Badge variant="muted" className="flex-shrink-0">contract</Badge>
        )}
      </span>

      <CheckIcon
        className={cn(
          'w-4 h-4 flex-shrink-0',
          isActive ? 'opacity-100' : 'opacity-0'
        )}
      />
    </CommandItem>
  );
}