import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { Button } from "./ui/button";
import { useUser } from "@/hooks/use-user";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export const UserMenuMobile = () => {
  const user = useUser();

  if (!user) return null;

  return (
    <div className="flex flex-col items-center justify-center gap-y-4">
      <p className="text-sm font-bold">{user.email}</p>
      <Button>
        <Link href={process.env.NEXT_PUBLIC_COSMO_CP_URL + "/v1/auth/logout"}>
          Logout
        </Link>
      </Button>
    </div>
  );
};

export const UserMenu = () => {
  const user = useUser();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="flex flex-row px-2 text-sm">
          <Avatar className="h-6 w-6 cursor-pointer">
            {/* <AvatarImage alt={user.email} /> */}
            <AvatarFallback className="rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 text-xs">
              {user.email[0]}
            </AvatarFallback>
          </Avatar>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        <p className="cursor-text truncate px-2 py-1.5 text-sm font-semibold">
          {user.email}
        </p>
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
