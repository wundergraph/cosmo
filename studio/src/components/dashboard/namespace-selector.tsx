import { CommandItem, CommandGroup, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/hooks/use-workspace";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import * as React from "react";
import { CheckIcon, CaretSortIcon } from "@radix-ui/react-icons";
import { docsBaseURL } from "@/lib/constants";
import { WorkspaceCommandWrapper } from "./workspace-command-wrapper"
import { useCurrentOrganization } from "@/hooks/use-current-organization";

interface NamespaceSelectorProps {
  isViewingGraphOrSubgraph: boolean;
  truncateNamespace: boolean;
}

export function NamespaceSelector({ isViewingGraphOrSubgraph, truncateNamespace }: NamespaceSelectorProps) {
  const [filter, setFilter] = useState('');
  const [isOpen, setOpen] = useState(false);
  const { isLoading, namespace, namespaceByName, setNamespace } = useWorkspace();

  const router = useRouter();
  const organizationSlug = useCurrentOrganization()?.slug;
  const pathname = useMemo(
    () => router.pathname.split('/').length === 3 ? router.pathname : '/[organizationSlug]/graphs',
    [router.pathname]
  );

  const namespaces = Array.from(namespaceByName.keys());
  if (isLoading) {
    return (
      <span
        className="flex justify-start items-center text-primary text-sm bg-primary/15 rounded-lg flex-shrink-0 animate-pulse px-3 py-1.5 gap-x-4"
      >
        <span
          className={cn(
            truncateNamespace && "max-w-[180px] lg:max-w-xs truncate"
          )}
        >
          {namespace.name}
        </span>
        <CaretSortIcon className="h-4 w-4 flex-shrink-0 opacity-50" />
      </span>
    );
  }

  return (
    <div className="flex items-center justify-start">
      {isViewingGraphOrSubgraph && (
        <Link
          href={{
            pathname,
            query: { organizationSlug, namespace: namespace.name },
          }}
          className={cn(
            "bg-primary/15 hover:bg-primary/30 text-primary transition-colors duration-150 pl-3 pr-2 py-1.5 rounded-l-lg text-sm flex-shrink-0",
            truncateNamespace && "max-w-[180px] lg:max-w-xs truncate"
          )}
          onClick={() => setNamespace(namespace.name, false)}
        >
          {namespace.name}
        </Link>
      )}
      <Popover
        modal
        open={isOpen}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            // Only reset the filter when the popover is opened
            setFilter('');
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "bg-primary/15 hover:bg-primary/30 text-primary transition-colors duration-150 text-sm flex-shrink-0 border-none outline-none",
              isViewingGraphOrSubgraph
                ? "rounded-r-lg pl-2 pr-3 py-2"
                : "flex justify-start items-center gap-4 rounded-lg px-3 py-1.5"
            )}
          >
            {!isViewingGraphOrSubgraph && (
              <span
                className={cn(truncateNamespace && "max-w-[180px] lg:max-w-xs truncate")}
              >
                {namespace.name}
              </span>
            )}
            <CaretSortIcon className="h-4 w-4 flex-shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>

        <WorkspaceCommandWrapper
          showFilter={!isViewingGraphOrSubgraph}
          filter={filter}
          setFilter={setFilter}
          close={() => {
            setOpen(false);
            setFilter('');
          }}
        >
          <div className="max-w-xs p-2 ">
            <p>Namespaces</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Easily switch between namespaces. Learn more{" "}
              <Link
                target="_blank"
                className="text-primary"
                href={`${docsBaseURL}/cli/essentials#namespaces`}
              >
                here.
              </Link>
            </p>
          </div>
          {namespaces.length > 0 && (
            <>
              <CommandSeparator className="w-full" />
              <CommandGroup>
                {namespaces.map((ns) => (
                  <CommandItem
                    key={`namespace-${ns}`}
                    className="cursor-pointer pl-4 gap-2 justify-between w-full"
                    value={ns}
                    onSelect={() => {
                      router.push({
                        pathname,
                        query: { organizationSlug, namespace: ns },
                      });

                      setOpen(false);
                      setNamespace(ns, false);
                    }}>
                    {ns}

                    <CheckIcon
                      className={cn(
                        'w-4 h-4 flex-shrink-0',
                        ns === namespace.name ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </WorkspaceCommandWrapper>
      </Popover>
    </div>
  );
}