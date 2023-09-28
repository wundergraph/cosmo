import { Component2Icon } from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { IoKeyOutline, IoPeopleOutline } from "react-icons/io5";
import {
  PiGraphLight,
  PiWebhooksLogo
} from "react-icons/pi";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { Nav, NavLink } from "./nav";
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
        icon: <PiGraphLight />,
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
        icon: <IoPeopleOutline />,
      },
      {
        title: "API Keys",
        href: basePath + "/apikeys",
        icon: <IoKeyOutline />,
      },
      {
        title: "Webhooks",
        href: basePath + "/webhooks",
        icon: <PiWebhooksLogo />,
      },
    ];
  }, [organizationSlug]);

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <div className="min-h-screen bg-background font-sans antialiased 2xl:min-w-[1536px] 2xl:max-w-screen-2xl">
        <Nav links={links} canChangeOrgs={true}>
          {children}
        </Nav>
      </div>
    </div>
  );
};

export const getDashboardLayout = (
  page: React.ReactNode,
  title: string,
  subtitle: string,
  items?: React.ReactNode
) => {
  return (
    <DashboardLayout>
      <PageHeader title={`Dashboard | ${title}`}>
        <TitleLayout title={title} subtitle={subtitle} items={items}>
          {page}
        </TitleLayout>
      </PageHeader>
    </DashboardLayout>
  );
};
