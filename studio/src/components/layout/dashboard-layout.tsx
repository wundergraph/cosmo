import { Component2Icon, EnvelopeClosedIcon } from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { useMemo } from "react";
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

export const DashboardLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;

  const links: NavLink[] = useMemo(() => {
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
