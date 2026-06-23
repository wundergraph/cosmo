import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { socialProviderLabel } from '@/lib/utils';
import { useUser } from '@/hooks/use-user';
import { resetTracking } from '@/lib/track';
import { LoginMethodType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Button } from './ui/button';
import { PropsWithChildren } from 'react';

const localStorageKeysToRemove = [
  'graphiql:headers',
  'graphiql:queries',
  'graphiql:tabState',
  'graphiql:variables',
  'graphiql:query',
  'graphiql:operationName',
  'playground:pre-flight:selected',
  'playground:pre-operation:selected',
  'playground:post-operation:selected',
  'playground:script:tabState',
];

const localStorageKeysPrefixesToRemove = ['cosmo-playground:'];

function removeLocalStorageItems() {
  if (typeof window === 'undefined') {
    return;
  }

  for (const key of localStorageKeysToRemove) {
    window.localStorage.removeItem(key);
  }

  for (const key of localStorageKeysPrefixesToRemove) {
    for (const storageKey of Object.keys(window.localStorage)) {
      if (storageKey.startsWith(key)) {
        window.localStorage.removeItem(storageKey);
      }
    }
  }
}

export const LogoutLink = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <Link
      onClick={() => {
        removeLocalStorageItems();
        resetTracking();
      }}
      href={process.env.NEXT_PUBLIC_COSMO_CP_URL + '/v1/auth/logout'}
      className={className}
    >
      {children || 'Logout'}
    </Link>
  );
};

export const UserMenuMobile = () => {
  const user = useUser();

  if (!user) return null;

  return (
    <div className="flex flex-col items-center justify-center gap-y-4">
      <p className="text-sm font-bold">{user.email}</p>
      <Button>
        <LogoutLink />
      </Button>
    </div>
  );
};

export const UserMenu = () => {
  const user = useUser();

  if (!user) return null;

  const loginMethod = user.loginMethod;
  const hasInvitations = user.invitations.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="relative flex flex-row px-2 text-sm">
          <Avatar className="relative h-6 w-6 cursor-pointer">
            {/* <AvatarImage alt={user.email} /> */}
            <AvatarFallback className="rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 text-xs text-white">
              {user.email[0]}
            </AvatarFallback>
          </Avatar>
          {hasInvitations ? (
            <div className="pointer-events-none absolute right-0 top-0 -translate-x-0.5 -translate-y-0.5 rounded-full border-2 border-background">
              <div className="absolute size-2 animate-ping rounded-full bg-blue-400" />
              <div className="size-2 rounded-full bg-blue-400" />
            </div>
          ) : null}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <div className="px-2 py-1.5">
          <p className="cursor-text truncate text-sm font-semibold">{user.email}</p>
          {loginMethod?.type === LoginMethodType.SSO && (
            <p className="truncate text-xs text-muted-foreground">
              Logged in via {loginMethod.ssoProviderName || loginMethod.ssoAlias || 'SSO'}
            </p>
          )}
          {loginMethod?.type === LoginMethodType.SOCIAL && (
            <p className="truncate text-xs text-muted-foreground">
              Logged in via {socialProviderLabel(loginMethod.socialProvider)}
            </p>
          )}
          {loginMethod?.type === LoginMethodType.PASSWORD && (
            <p className="text-xs text-muted-foreground">Logged in via password</p>
          )}
        </div>
        <Link href="/account/invitations">
          <DropdownMenuItem>
            Invitations
            {hasInvitations ? (
              <div className="relative ml-auto">
                <div className="absolute size-2 animate-ping rounded-full bg-blue-400" />
                <div className="size-2 rounded-full bg-blue-400" />
              </div>
            ) : null}
          </DropdownMenuItem>
        </Link>
        <DropdownMenuSeparator />
        <ThemeToggle />
        <DropdownMenuSeparator />
        <LogoutLink>
          <DropdownMenuItem>Logout</DropdownMenuItem>
        </LogoutLink>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
