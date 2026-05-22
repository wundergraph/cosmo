import { CommandItem, CommandGroup, CommandSeparator } from '@/components/ui/command';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { useWorkspace } from '@/hooks/use-workspace';
import { useUser } from '@/hooks/use-user';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { cn, socialProviderLabel } from '@/lib/utils';
import * as React from 'react';
import { CheckIcon, CaretSortIcon } from '@radix-ui/react-icons';
import { docsBaseURL } from '@/lib/constants';
import { LoginMethodType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { WorkspaceCommandWrapper } from './workspace-command-wrapper';
import { useCurrentOrganization } from '@/hooks/use-current-organization';

interface NamespaceSelectorProps {
  isViewingGraphOrSubgraph: boolean;
  truncateNamespace: boolean;
}

export function NamespaceSelector({ isViewingGraphOrSubgraph, truncateNamespace }: NamespaceSelectorProps) {
  const [filter, setFilter] = useState('');
  const [isOpen, setOpen] = useState(false);
  const { isLoading, namespace, namespaceByName, setNamespace } = useWorkspace();
  const loginMethod = useUser()?.loginMethod;
  // SSO, social and password logins can all be gated, so the visibility hint
  // applies to any of them. (API-key logins never reach the web UI.)
  const isGatedLogin =
    loginMethod?.type === LoginMethodType.SSO ||
    loginMethod?.type === LoginMethodType.SOCIAL ||
    loginMethod?.type === LoginMethodType.PASSWORD;

  let loginMethodLabel = 'password';
  if (loginMethod?.type === LoginMethodType.SSO) {
    loginMethodLabel = loginMethod.ssoProviderName || loginMethod.ssoAlias || 'SSO';
  } else if (loginMethod?.type === LoginMethodType.SOCIAL) {
    loginMethodLabel = socialProviderLabel(loginMethod.socialProvider);
  }

  const router = useRouter();
  const organizationSlug = useCurrentOrganization()?.slug;
  const pathname = useMemo(
    () => (router.pathname.split('/').length === 3 ? router.pathname : '/[organizationSlug]/graphs'),
    [router.pathname],
  );

  const namespaces = Array.from(namespaceByName.keys());
  const hasNoAccess = !isLoading && namespaces.length === 0;
  const displayName = hasNoAccess ? 'No access' : namespace.name;
  if (isLoading) {
    return (
      <span className="flex flex-shrink-0 animate-pulse items-center justify-start gap-x-4 rounded-lg bg-primary/15 px-3 py-1.5 text-sm text-primary">
        <span className={cn(truncateNamespace && 'max-w-[180px] truncate lg:max-w-xs')}>{namespace.name}</span>
        <CaretSortIcon className="h-4 w-4 flex-shrink-0 opacity-50" />
      </span>
    );
  }

  return (
    <div className="flex items-center justify-start">
      {isViewingGraphOrSubgraph && !hasNoAccess && (
        <>
          <Link
            href={{
              pathname,
              query: { organizationSlug, namespace: namespace.name },
            }}
            className={cn(
              'flex-shrink-0 rounded-l-lg bg-primary/15 py-1.5 pl-3 pr-2 text-sm text-primary transition-colors duration-150 hover:bg-primary/30',
              truncateNamespace && 'max-w-[180px] truncate lg:max-w-xs',
            )}
            onClick={() => setNamespace(namespace.name, false)}
          >
            {namespace.name}
          </Link>
          <div className="h-8 w-[1px] bg-primary/30" />
        </>
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
              'flex-shrink-0 border-none bg-primary/15 text-sm text-primary outline-none transition-colors duration-150 hover:bg-primary/30',
              isViewingGraphOrSubgraph
                ? 'rounded-r-lg py-2 pl-2 pr-3'
                : 'flex items-center justify-start gap-4 rounded-lg px-3 py-1.5',
            )}
          >
            {(hasNoAccess || !isViewingGraphOrSubgraph) && (
              <span
                className={cn(
                  truncateNamespace && 'max-w-[180px] truncate lg:max-w-xs',
                  hasNoAccess && 'text-muted-foreground',
                )}
              >
                {displayName}
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
              Easily switch between namespaces. Learn more{' '}
              <Link target="_blank" className="text-primary" href={`${docsBaseURL}/cli/essentials#namespaces`}>
                here.
              </Link>
            </p>
            {isGatedLogin && (
              <p className="mt-2 flex items-start gap-x-1.5 text-sm text-muted-foreground">
                <span>
                  Some namespaces may be hidden because they&apos;re not enabled for your current login method (
                  {loginMethodLabel}).
                </span>
              </p>
            )}
          </div>
          {namespaces.length > 0 && (
            <>
              <CommandSeparator className="w-full" />
              <CommandGroup>
                {namespaces.map((ns) => (
                  <CommandItem
                    key={`namespace-${ns}`}
                    className="w-full cursor-pointer justify-between gap-2 pl-4"
                    value={ns}
                    onSelect={() => {
                      router.push({
                        pathname,
                        query: { organizationSlug, namespace: ns },
                      });

                      setOpen(false);
                      setNamespace(ns, false);
                    }}
                  >
                    {ns}

                    <CheckIcon
                      className={cn('h-4 w-4 flex-shrink-0', ns === namespace.name ? 'opacity-100' : 'opacity-0')}
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
