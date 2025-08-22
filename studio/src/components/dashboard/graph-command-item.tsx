import { useRouter } from "next/router";
import { useMemo } from "react";
import * as React from "react";
import { CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { CheckIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

export interface GraphLinkProps {
  name: string;
  namespace: string;
  value: string;
  isSubgraph?: boolean;
  isContract?: boolean;
  isActive: boolean;
  className?: string;
  setNamespace(namespace: string): void;
}

export function GraphCommandItem({
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
  const pathname = useMemo(
    () => {
      const segment = router.pathname.split('/')[3]?.toLowerCase();
      if (isSubgraph) {
        return segment === 'subgraph'
          ? router.pathname
          : `/[organizationSlug]/[namespace]/subgraph/[subgraphSlug]`;
      }

      return segment === 'graph'
        ? router.pathname
        : `/[organizationSlug]/[namespace]/graph/[slug]`;
    },
    [router.pathname, isSubgraph],
  );

  const { organizationSlug } = router.query;

  return (
    <CommandItem
      className={cn(
        "cursor-pointer pl-4 gap-2 justify-between w-full",
        className
      )}
      value={value}
      onSelect={() => {
        router.push({
          pathname,
          query: {
            organizationSlug,
            namespace,
            ...(isSubgraph ? { subgraphSlug: name } : { slug: name }),
          }
        });

        setNamespace(namespace);
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