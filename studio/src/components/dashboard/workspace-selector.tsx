import * as React from 'react';

import { NamespaceSelector } from './namespace-selector';
import { GraphSelector } from './graph-selector';
import { useSubgraph } from '@/hooks/use-subgraph';
import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { useWorkspace } from '@/hooks/use-workspace';
import { cn } from '@/lib/utils';
import { WorkspaceSubgraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export interface WorkspaceSelectorProps {
  children?: React.ReactNode;
  truncateNamespace?: boolean;
}

export function WorkspaceSelector({ children, truncateNamespace = true }: WorkspaceSelectorProps) {
  const router = useRouter();
  const subgraphContext = useSubgraph();
  const { namespace } = useWorkspace();

  const [activeGraph, activeSubgraph, baseSubgraph] = useMemo(() => {
    const routePathSegments = router.asPath.split('/');
    const routeSegment = routePathSegments[3]?.toLowerCase();
    const currentSlug = (router.query.slug as string)?.toLowerCase();
    const currentSubgraphSlug = (router.query.subgraphSlug as string)?.toLowerCase();

    const nsGraphs = namespace.graphs;
    const nsSubgraphs = nsGraphs.flatMap((graph) => graph.subgraphs);

    const activeGraph =
      routeSegment === 'graph' ? nsGraphs.find((graph) => graph.name.toLowerCase() === currentSlug) : undefined;

    // Try to find the currently active subgraph by id
    let baseSubgraph: WorkspaceSubgraph | undefined;
    let activeSubgraph = !!subgraphContext?.subgraph?.id
      ? nsSubgraphs.find((subgraph) => subgraph.id === subgraphContext?.subgraph?.id)
      : undefined;

    if (!activeGraph && !activeSubgraph && routeSegment === 'subgraph' && !!currentSubgraphSlug) {
      // We couldn't find the subgraph, try to find it on the feature subgraphs
      activeSubgraph = namespace.featureSubgraphs.find((fsg) => fsg.name.toLowerCase() === currentSubgraphSlug);
      if (activeSubgraph?.baseSubgraphId) {
        // Find the base base subgraph by id
        baseSubgraph = nsSubgraphs.find((subgraph) => subgraph.id === activeSubgraph?.baseSubgraphId);
      }
    }

    return [activeGraph, activeSubgraph, baseSubgraph];
  }, [
    namespace.featureSubgraphs,
    namespace.graphs,
    router.asPath,
    router.query.slug,
    router.query.subgraphSlug,
    subgraphContext?.subgraph?.id,
  ]);

  const isViewingGraphOrSubgraph = !!activeGraph || !!activeSubgraph;
  return (
    <div className={cn('flex h-9 items-center justify-start text-sm', isViewingGraphOrSubgraph && 'gap-x-2')}>
      <NamespaceSelector isViewingGraphOrSubgraph={isViewingGraphOrSubgraph} truncateNamespace={truncateNamespace} />
      <GraphSelector activeGraph={activeGraph} activeSubgraph={activeSubgraph} />
      <div className="flex flex-1 items-center justify-start gap-x-2 truncate text-sm">{children}</div>
    </div>
  );
}
