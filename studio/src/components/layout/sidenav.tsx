import { docsBaseURL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  Component2Icon,
  Cross2Icon,
  HamburgerMenuIcon,
  QuestionMarkCircledIcon,
} from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { getFederatedGraphs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useContext, useMemo, useState } from "react";
import { UserContext } from "../app-provider";
import { Logo } from "../logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { UserMenu, UserMenuMobile } from "../user-menu";
import { LayoutProps } from "./layout";
import { useUser } from "@/hooks/use-user";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { PiGear, PiGraphLight } from "react-icons/pi";
import {
  IoKeyOutline,
  IoNotificationsOutline,
  IoPeopleOutline,
} from "react-icons/io5";
import { Portal } from "@radix-ui/react-tooltip";
import {
  FiChevronLeft,
  FiHelpCircle,
  FiPlus,
  FiSettings,
} from "react-icons/fi";

export type NavLink = {
  title: string;
  href: string;
  matchExact?: boolean;
  icon: ReactNode;
  separator?: boolean;
};

const isActive = (path: string, currentPath: string, exact = true) => {
  return path === "/" || exact ? path === currentPath : currentPath.match(path);
};

const isExternalUrl = (link: string): boolean => !link?.startsWith("/");

interface SideNavLayoutProps extends LayoutProps {
  links?: NavLink[];
}

const MobileNav = () => {
  return (
    <div
      className={cn(
        "fixed inset-0 top-28 z-50 grid h-[calc(100vh-112px)] grid-flow-row auto-rows-max overflow-auto border-t bg-popover shadow-md animate-in slide-in-from-bottom-64 lg:hidden",
      )}
    >
      <div className="relative z-20 grid gap-6 rounded-md p-4 text-popover-foreground">
        <nav className="grid grid-flow-row auto-rows-max items-center justify-center text-center text-sm">
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
        <div className="mx-auto">{/* <ThemeToggle /> */}</div>
      </div>
    </div>
  );
};

const Graphs = () => {
  const { data } = useQuery(getFederatedGraphs.useQuery());

  const router = useRouter();
  const slug = router.query.slug as string;
  const organizationSlug = router.query.organizationSlug as string;
  if (router.pathname.split("/")[2] !== "graph") return null;

  return (
    <div className="hidden w-full lg:flex">
      <Select
        value={slug}
        onValueChange={(gID) =>
          router.push(`/${organizationSlug}/graph/${gID}`)
        }
      >
        <SelectTrigger value={slug} className="w-[200px] lg:w-full">
          <SelectValue aria-label={slug}>{slug}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {data?.graphs?.map(({ name }) => {
            return (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};

const Organizations = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const currentPage = router.asPath.split("/")[2];

  if (!user?.currentOrganization) return null;

  return (
    <Select
      value={user.currentOrganization.slug}
      onValueChange={(orgSlug) => {
        const currentOrg = user.organizations.find(
          (org) => org.slug === orgSlug,
        );
        if (currentOrg) {
          router.replace(
            currentPage === "graph"
              ? `/${currentOrg.slug}/graphs`
              : `/${currentOrg.slug}/${currentPage}`,
          );
        }
      }}
    >
      <SelectTrigger
        value={user.currentOrganization.name}
        className="flex h-8 w-[200px] gap-x-2 border-0 bg-transparent px-2 shadow-none data-[state=open]:bg-accent hover:bg-accent hover:text-accent-foreground focus:ring-0 lg:w-full"
      >
        <SelectValue aria-label={user.currentOrganization.name}>
          <span className="flex w-36 truncate font-medium capitalize">
            {user.currentOrganization.name}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {user?.organizations?.map(({ name, slug }) => {
          return (
            <SelectItem key={slug} value={slug}>
              {name}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

export const SideNav = (props: SideNavLayoutProps) => {
  const router = useRouter();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const user = useUser();

  const organizationSlug = router.query.organizationSlug as string;

  const mainNav: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}`;

    return [
      {
        title: "Federated Graphs",
        href: basePath + "/graphs",
        icon: <PiGraphLight size="1.2em" />,
        separator: true,
      },
      {
        title: "Settings",
        href: basePath + "/settings",
        icon: <PiGear size="1.2em" />,
      },
    ];
  }, [organizationSlug]);

  const main = (
    <aside className="sticky top-[0] z-40 flex w-[60px] flex-shrink-0 flex-col bg-accent bg-background pt-4 lg:h-screen lg:px-3 lg:pb-4">
      <div className="flex flex-col gap-y-4 px-4 lg:gap-y-8 lg:px-0">
        <div className="flex items-center justify-between gap-x-4">
          <div className="ml-4">
            <Link
              href={
                user?.currentOrganization
                  ? `/${user.currentOrganization.slug}`
                  : `/`
              }
            >
              <Logo />
            </Link>
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
        <nav className="flex items-center gap-2 overflow-x-auto scrollbar-none lg:grid lg:items-start">
          {mainNav?.map((item, index) => {
            const isCurrent = isActive(
              encodeURI(item.href),
              router.asPath.split("?")[0],
              item.matchExact,
            );

            return (
              <div key={index}>
                {item.href && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        key={index}
                        href={item.href}
                        className={cn(
                          "text-md font-sm group flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground",
                          isCurrent ? "bg-accent/80" : "transparent",
                        )}
                      >
                        {item.icon}
                      </Link>
                    </TooltipTrigger>
                    <Portal>
                      <TooltipContent side="left">{item.title}</TooltipContent>
                    </Portal>
                  </Tooltip>
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
      <Separator orientation="horizontal" className="mt-4 lg:mb-4 lg:mt-auto" />
      <div className="hidden flex-col items-center space-y-2 lg:flex">
        <Link
          href={docsBaseURL}
          className="text-md font-sm group flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
          target="_blank"
          rel="noreferrer"
        >
          <QuestionMarkCircledIcon />
        </Link>
        <UserMenu />
      </div>
    </aside>
  );

  const isSettings = router.pathname.split("/")[2] === "settings";

  return (
    <div className="lg:grid lg:grid-cols-[auto_1fr] lg:divide-x">
      <div className="sticky top-[0] z-40 flex min-w-[210px] flex-shrink-0 flex-col bg-background pt-4 lg:h-screen lg:px-3 lg:pb-4">
        <div className="flex min-h-0 flex-1 flex-col gap-y-4 px-4 lg:gap-y-8 lg:px-0">
          <div className="flex items-center justify-between gap-x-4">
            <div className="flex w-full items-center space-x-2">
              {isSettings ? (
                <>
                  <Link
                    href={`/${organizationSlug}/graphs`}
                    className="group flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    <FiChevronLeft
                      size="1.2em"
                      className="transition-all group-hover:-translate-x-1"
                    />
                    Settings
                  </Link>
                </>
              ) : (
                <>
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
                  <Organizations />
                </>
              )}
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
          <nav className="space-y-1 overflow-y-auto scrollbar-none">
            {props.links?.map((item, index) => {
              const isCurrent = isActive(
                encodeURI(item.href),
                router.asPath.split("?")[0],
                item.matchExact,
              );

              return (
                <div key={index}>
                  {item.href && (
                    <Link
                      key={index}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                        isCurrent ? "bg-accent/80" : "transparent",
                      )}
                    >
                      {item.icon}

                      <span className="whitespace-nowrap">{item.title}</span>
                    </Link>
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

        <div className="py-2">
          {/* <Link
            href={docsBaseURL}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            target="_blank"
            rel="noreferrer"
          >
            <FiPlus />
            Invite team
          </Link> */}
          <Link
            href={docsBaseURL}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            target="_blank"
            rel="noreferrer"
          >
            <FiHelpCircle />
            Documentation
          </Link>
        </div>
        <div className="hidden items-center justify-between space-x-2 border-t pt-2 lg:flex">
          <UserMenu />
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`/${organizationSlug}/settings`}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                <FiSettings size="1.1em" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
