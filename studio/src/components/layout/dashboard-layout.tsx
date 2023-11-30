import { Component2Icon } from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { useMemo } from "react";
import {
  IoKeyOutline,
  IoNotificationsOutline,
  IoPeopleOutline,
} from "react-icons/io5";
import { MdDataUsage } from "react-icons/md";
import { PiGear, PiGraphLight } from "react-icons/pi";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { SideNav, NavLink } from "./sidenav";
import { TitleLayout } from "./title-layout";
import { FiBell, FiKey, FiSettings, FiUsers } from "react-icons/fi";

export const DashboardLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}`;

    return [
      {
        title: "Federated Graphs",
        href: basePath + "/graphs",
        icon: <PiGraphLight size="1.2em" />,
      },
      {
        title: "Subgraphs",
        href: basePath + "/subgraphs",
        icon: <Component2Icon />,
        separator: true,
      },
      {
        title: "Members",
        href: basePath + "/members",
        icon: <FiUsers />,
      },
      {
        title: "API Keys",
        href: basePath + "/apikeys",
        icon: <FiKey />,
      },
      {
        title: "Notifications",
        href: basePath + "/webhooks",
        icon: <FiBell />,
      },
      {
        title: "Usages",
        href: basePath + "/usages",
        icon: <MdDataUsage />,
      },
      {
        title: "Settings",
        href: basePath + "/settings",
        icon: <FiSettings />,
      },
    ];
  }, [organizationSlug]);

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <div className="flex min-h-screen w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:grid-cols-[auto_1fr] lg:divide-x">
        <SideNav links={links}>{children}</SideNav>
        <main className="flex-1 pt-4 lg:pt-0">{children}</main>
      </div>
    </div>
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
