import { Component2Icon } from "@radix-ui/react-icons";
import { addDays, formatDistance } from "date-fns";
import { useRouter } from "next/router";
import { useContext, useMemo } from "react";
import {
  IoKeyOutline,
  IoNotificationsOutline,
  IoPeopleOutline,
} from "react-icons/io5";
import { PiGear, PiGraphLight } from "react-icons/pi";
import { UserContext } from "../app-provider";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { Nav, NavLink } from "./nav";
import { TitleLayout } from "./title-layout";
import Link from "next/link";
import { calURL } from "@/lib/constants";

export const DashboardLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;

  const user = useContext(UserContext);

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
        title: "Notifications",
        href: basePath + "/webhooks",
        icon: <IoNotificationsOutline />,
      },
      {
        title: "Settings",
        href: basePath + "/settings",
        icon: <PiGear />,
      },
    ];
  }, [organizationSlug]);

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <div className="min-h-screen w-full max-w-screen-4xl bg-background font-sans antialiased">
        {user?.currentOrganization.isFreeTrial && (
          <Link
            className="sticky top-0 z-50 flex cursor-pointer justify-center rounded bg-primary px-2 py-1 text-sm text-secondary-foreground"
            href={calURL}
            target="_blank"
            rel="noreferrer"
          >
            <span>
              Limited trial version.{" "}
              <span className="underline underline-offset-2">
                Talk to sales
              </span>{" "}
              for Production use.
            </span>
          </Link>
        )}
        <Nav links={links}>{children}</Nav>
      </div>
    </div>
  );
};

export const getDashboardLayout = (
  page: React.ReactNode,
  title: string,
  subtitle: string,
  items?: React.ReactNode,
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
