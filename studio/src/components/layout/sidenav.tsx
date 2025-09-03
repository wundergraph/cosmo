import { docsBaseURL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  CaretSortIcon,
  Cross2Icon,
  HamburgerMenuIcon,
} from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useContext, useState } from "react";
import { UserContext } from "../app-provider";
import { Logo } from "../logo";
import { Separator } from "../ui/separator";
import { UserMenu, UserMenuMobile } from "../user-menu";
import { LayoutProps } from "./layout";
import { useUser } from "@/hooks/use-user";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { FiHelpCircle } from "react-icons/fi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import NewFeaturesPopup from "../dashboard/NewFeaturesPopup";

export type NavLink = {
  title: ReactNode;
  className?: string;
  href: string;
  matchExact?: boolean;
  icon: ReactNode;
  separator?: boolean;
};

const isActive = (path: string, currentPath: string, exact = true) => {
  return path === "/" || exact ? path === currentPath : currentPath.match(path);
};

const MobileNav = () => {
  const user = useUser();
  return (
    <div
      className={cn(
        "fixed inset-0 top-28 z-50 grid h-[calc(100vh-112px)] grid-flow-row auto-rows-max overflow-auto border-t bg-popover shadow-md animate-in slide-in-from-bottom-64 lg:hidden",
      )}
    >
      <div className="relative z-20 grid gap-6 rounded-md p-4 text-popover-foreground">
        <nav className="grid grid-flow-row auto-rows-max items-center justify-center space-y-2 text-center text-sm">
          <Link
            href="/account/invitations"
            className="flex items-center justify-center gap-x-2"
          >
            Invitations
            {user?.invitations?.length && (
              <div className="relative">
                <div
                  aria-hidden="true"
                  className="absolute h-2 w-2 animate-ping rounded-full bg-blue-400"
                />
                <div
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-blue-400"
                />
              </div>
            )}
          </Link>

          <Link
            href={docsBaseURL}
            className="flex items-center text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Documentation
          </Link>
        </nav>
        <UserMenuMobile />
      </div>
    </div>
  );
};

const Organizations = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const currentPage = router.asPath.split("/")[2];
  const isOrganizationRoot = router.asPath.split("/").length === 3;

  if (!user?.currentOrganization) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={user.currentOrganization.name}
        className="flex h-8 w-auto flex-1 items-center gap-x-2 rounded-md border-0 bg-transparent px-2 shadow-none outline-none ring-pink-600/50 data-[state=open]:bg-accent hover:bg-accent hover:text-accent-foreground focus-visible:ring-2"
      >
        <DropdownMenuLabel className="flex flex-1 truncate px-0 font-medium">
          {user.currentOrganization.name}
        </DropdownMenuLabel>
        <CaretSortIcon className="h-4 w-4 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuRadioGroup
          value={user.currentOrganization.slug}
          onValueChange={(orgSlug) => {
            const currentOrg = user.organizations.find(
              (org) => org.slug === orgSlug,
            );
            if (currentOrg) {
              router.replace(
                isOrganizationRoot && currentPage !== "invitations"
                  ? `/${currentOrg.slug}/${currentPage}`
                  : `/${currentOrg.slug}`,
              );
            }
          }}
        >
          {user?.organizations?.map(({ name, slug }) => {
            return (
              <DropdownMenuRadioItem className="pl-2" key={slug} value={slug}>
                {name}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/create">Create a new organization</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface SideNavLayoutProps extends LayoutProps {
  links?: Partial<NavLink>[];
  isBannerDisplayed?: boolean;
}

export const SideNav = (props: SideNavLayoutProps) => {
  const router = useRouter();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const user = useUser();

  return (
    <div className="lg:grid lg:grid-cols-[auto_1fr] lg:divide-x">
      <aside
        className={cn(
          "relative z-40 flex min-w-[210px] flex-shrink-0 flex-col bg-background pt-4 lg:px-3 lg:pb-4",
          {
            "lg:h-[calc(100vh-32px)]": props.isBannerDisplayed,
            "lg:h-screen": !props.isBannerDisplayed,
          },
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-y-4 px-4 lg:gap-y-6 lg:px-0">
          <div className="flex items-center justify-between gap-x-4">
            <div className="flex w-full items-center space-x-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={
                      user?.currentOrganization
                        ? `/${user.currentOrganization.slug}`
                        : `/`
                    }
                    className="ml-2"
                  >
                    <Logo />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>All Federated Graphs</TooltipContent>
              </Tooltip>

              <Organizations />
            </div>

            <button
              className="flex items-center space-x-2 lg:hidden"
              onClick={() => setShowMobileMenu(!showMobileMenu)}
            >
              {showMobileMenu ? (
                <Cross2Icon className="h-5 w-5" />
              ) : (
                <HamburgerMenuIcon className="h-5 w-5" />
              )}
            </button>
            {showMobileMenu && <MobileNav />}
          </div>
          <nav className="flex items-center space-y-1 overflow-x-auto scrollbar-none lg:block lg:overflow-y-auto lg:overflow-x-visible lg:scrollbar-thin">
            {props.links?.map((item, index) => {
              if (!item) return null;

              const isCurrent =
                item.href &&
                isActive(
                  encodeURI(item.href),
                  router.asPath.split("?")[0],
                  item.matchExact,
                );

              return (
                <div key={index}>
                  {item.href ? (
                    <Link
                      key={index}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                        isCurrent ? "bg-accent/80" : "transparent",
                      )}
                    >
                      {item.icon}

                      <span className={cn("whitespace-nowrap", item.className)}>
                        {item.title}
                      </span>
                    </Link>
                  ) : (
                    <h4 className="hidden px-3 py-2 text-sm text-muted-foreground lg:block">
                      {item.title}
                    </h4>
                  )}
                  {item.separator && (
                    <Separator
                      orientation="horizontal"
                      className="my-3 hidden lg:block"
                    />
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="hidden items-center justify-between space-x-2 border-t pt-2 lg:flex">
          <Link
            href={docsBaseURL}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            target="_blank"
            rel="noreferrer"
          >
            <FiHelpCircle />
            Documentation
          </Link>
          <UserMenu />
        </div>
        <div className="absolute bottom-3 left-3 z-50 hidden lg:block">
          <NewFeaturesPopup />
        </div>
      </aside>
    </div>
  );
};
