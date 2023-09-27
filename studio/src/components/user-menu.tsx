import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { useContext } from "react";
import { UserContext } from "./app-provider";
import { Button } from "./ui/button";

export const UserMenuMobile = () => {
  const [user] = useContext(UserContext);

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
  const [user] = useContext(UserContext);

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="h-6 w-6 cursor-pointer rounded-full bg-gradient-to-r from-indigo-500 to-pink-500"></div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        <p className="cursor-text truncate px-2 py-1.5 text-sm font-semibold">
          {user.email}
        </p>
        <DropdownMenuSeparator />
        <Link href={process.env.NEXT_PUBLIC_COSMO_CP_URL + "/v1/auth/logout"}>
          <DropdownMenuItem>Logout</DropdownMenuItem>
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
