import {
  Component2Icon,
  Cross1Icon,
  EnvelopeClosedIcon,
} from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import {
  Dispatch,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PiBell,
  PiChartDonut,
  PiGear,
  PiGraphLight,
  PiKey,
  PiUsers,
} from "react-icons/pi";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { SideNav, NavLink } from "./sidenav";
import { TitleLayout } from "./title-layout";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/use-local-storage";

export const StarBanner = ({
  setDisableStarBanner,
}: {
  setDisableStarBanner: Dispatch<SetStateAction<string>>;
}) => {
  return (
    <div className="flex h-8 justify-center">
      <div className="flex w-full justify-center bg-gradient-to-r from-purple-500 to-pink-400 text-xs xl:text-sm">
        <a
          href="//github.com/wundergraph/cosmo"
          className="z-10 flex h-full items-center justify-between space-x-2.5 py-1.5 pl-3 pr-2"
          target="_blank"
          rel="noreferrer"
        >
          <span className="flex items-center gap-x-2">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-400 opacity-75 dark:bg-white"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-pink-400 dark:bg-white"></span>
            </span>
            <span className="mx-2 text-gray-950 dark:text-slate-100">
              If you like WunderGraph Cosmo,{" "}
              <span className="font-bold">give it a star on GitHub! ⭐️ </span>
            </span>
          </span>
        </a>
        <div
          onClick={() => {
            setDisableStarBanner("true");
          }}
          className="absolute right-3 top-2 cursor-pointer"
        >
          <Cross1Icon />
        </div>
      </div>
    </div>
  );
};

export const DashboardLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const [disableStarBanner, setDisableStarBanner] = useLocalStorage(
    "disableStarBanner",
    "false",
  );
  const [render, setRender] = useState<string>();

  useEffect(() => {
    if (!disableStarBanner) return;
    setRender(disableStarBanner);
  }, [disableStarBanner]);

  const links: Partial<NavLink>[] = useMemo(() => {
    const basePath = `/${organizationSlug}`;

    return [
      {
        title: "Federated Graphs",
        href: basePath + "/graphs",
        icon: <PiGraphLight className="h-4 w-4" />,
      },
      {
        title: "Subgraphs",
        href: basePath + "/subgraphs",
        icon: <Component2Icon className="h-4 w-4" />,
        separator: true,
      },
      {
        title: "Members",
        href: basePath + "/members",
        icon: <PiUsers className="h-4 w-4" />,
      },
      {
        title: "API Keys",
        href: basePath + "/apikeys",
        icon: <PiKey className="h-4 w-4" />,
      },
      {
        title: "Notifications",
        href: basePath + "/webhooks",
        icon: <PiBell className="h-4 w-4" />,
      },
      {
        title: "Usage",
        href: basePath + "/usages",
        icon: <PiChartDonut className="h-4 w-4" />,
      },
      {
        title: "Settings",
        href: basePath + "/settings",
        icon: <PiGear className="h-4 w-4" />,
        separator: true,
      },
      {
        title: "Account",
      },
      {
        title: "Invitations",
        href: "/account/invitations",
        icon: <EnvelopeClosedIcon className="h-4 w-4" />,
      },
    ];
  }, [organizationSlug]);

  return (
    render && (
      <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
        {disableStarBanner !== "true" && (
          <StarBanner setDisableStarBanner={setDisableStarBanner} />
        )}
        <div
          className={cn(
            "flex w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:grid-cols-[auto_1fr] lg:divide-x",
            {
              "min-h-[calc(100vh-32px)]": disableStarBanner !== "true",
              "min-h-screen": disableStarBanner === "true",
            },
          )}
        >
          <SideNav links={links} disableStarBanner={disableStarBanner}>
            {children}
          </SideNav>
          <main className="flex-1 pt-4 lg:pt-0">{children}</main>
        </div>
      </div>
    )
  );
};

export const getDashboardLayout = (
  page: React.ReactNode,
  title: string,
  subtitle: string,
  items?: React.ReactNode,
  toolbar?: React.ReactNode,
) => {
  return (
    <DashboardLayout>
      <PageHeader title={`Dashboard | ${title}`}>
        <TitleLayout
          title={title}
          subtitle={subtitle}
          items={items}
          toolbar={toolbar}
        >
          {page}
        </TitleLayout>
      </PageHeader>
    </DashboardLayout>
  );
};
