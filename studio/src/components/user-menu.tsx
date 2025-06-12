import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@/hooks/use-user";
import { resetTracking } from "@/lib/track";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";

export const UserMenuMobile = () => {
  const user = useUser();

  if (!user) return null;

  return (
    <div className="flex flex-col items-center justify-center gap-y-4">
      <p className="text-sm font-bold">{user.email}</p>
      <Button>
        <Link
          onClick={() => {
            resetTracking();
          }}
          href={process.env.NEXT_PUBLIC_COSMO_CP_URL + "/v1/auth/logout"}
        >
          Logout
        </Link>
      </Button>
    </div>
  );
};

export const UserMenu = () => {
  const user = useUser();

  if (!user) return null;

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
            <div className="absolute right-0 top-0 -translate-x-0.5 -translate-y-0.5 rounded-full border-2 border-background">
              <div className="h-2 w-2 rounded-full bg-blue-400" />
            </div>
          ) : null}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        <p className="cursor-text truncate px-2 py-1.5 text-sm font-semibold">
          {user.email}
        </p>
        <Link href="/account/invitations">
          <DropdownMenuItem>
            Invitations
            {hasInvitations ? (
              <div className="relative ml-auto">
                <div className="absolute h-2 w-2 animate-ping rounded-full bg-blue-400" />
                <div className="h-2 w-2 rounded-full bg-blue-400" />
              </div>
            ) : null}
          </DropdownMenuItem>
        </Link>
        <DropdownMenuSeparator />
        <ThemeToggle />
        <DropdownMenuSeparator />
        <Link href={process.env.NEXT_PUBLIC_COSMO_CP_URL + "/v1/auth/logout"}>
          <DropdownMenuItem>Logout</DropdownMenuItem>
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
