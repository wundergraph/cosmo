import { showCal } from "@/lib/utils";
import { Component2Icon } from "@radix-ui/react-icons";
import { addDays, formatDistance } from "date-fns";
import { useRouter } from "next/router";
import { useContext, useMemo } from "react";
import { IoKeyOutline, IoPeopleOutline } from "react-icons/io5";
import { PiGear, PiGraphLight, PiWebhooksLogo } from "react-icons/pi";
import { UserContext } from "../app-provider";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { Nav, NavLink } from "./nav";
import { TitleLayout } from "./title-layout";

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
        title: "Webhooks",
        href: basePath + "/webhooks",
        icon: <PiWebhooksLogo />,
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
      <div className=" min-h-screen bg-background font-sans antialiased 2xl:min-w-[1536px] 2xl:max-w-screen-2xl">
        {user?.currentOrganization.isFreeTrial && (
          <div
            className="sticky top-0 z-50 flex cursor-pointer justify-center rounded bg-primary px-2 py-1 text-sm text-secondary-foreground"
            onClick={showCal}
          >
            {!user.currentOrganization.isFreeTrialExpired ? (
              <span>
                Limited trial version (
                {formatDistance(
                  addDays(new Date(user.currentOrganization.createdAt), 10),
                  new Date()
                )}{" "}
                left).{" "}
                <span className="underline underline-offset-2">
                  Talk to sales
                </span>{" "}
                for Production use.
              </span>
            ) : (
              <span>
                Limited trial has concluded.{" "}
                <span className="underline underline-offset-2">Click here</span>{" "}
                to contact us and upgrade your plan for continued usage.
              </span>
            )}
          </div>
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
