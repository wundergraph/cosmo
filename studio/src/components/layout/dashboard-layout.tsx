import { Component2Icon } from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { useContext, useMemo } from "react";
import { IoKeyOutline, IoPeopleOutline } from "react-icons/io5";
import { PiGraphLight, PiWebhooksLogo } from "react-icons/pi";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { Nav, NavLink } from "./nav";
import { TitleLayout } from "./title-layout";
import { UserContext } from "../app-provider";
import { createPopup } from "@typeform/embed";
import { cn } from "@/lib/utils";
import { addDays, formatDistance, subDays } from "date-fns";

export const openCosmoTypeForm = () => {
  // Waitlist form
  const toggle = createPopup(process.env.NEXT_PUBLIC_TYPEFORM_ID || "", {
    hideHeaders: true,
    size: 70,
  });
  toggle.open();
};

export const DashboardLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;

  const [user] = useContext(UserContext);
  const present = new Date();

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
      <div className=" min-h-screen bg-background font-sans antialiased 2xl:min-w-[1536px] 2xl:max-w-screen-2xl">
        {user?.currentOrganization.isFreeTrial && (
          <div
            className="flex cursor-pointer justify-center rounded bg-primary py-1 text-secondary-foreground sticky"
            onClick={openCosmoTypeForm}
          >
            {present <
            addDays(new Date(user.currentOrganization.createdAt), 10) ? (
              <span>
                Limited trial version (
                {formatDistance(
                  addDays(new Date(user.currentOrganization.createdAt), 10),
                  new Date()
                )}{" "}
                left). <a>Talk to sales</a> for Production use.
              </span>
            ) : (
              <span>
                Limited trial has concluded. Please{" "}
                <span className="underline underline-offset-2">
                  upgrade your plan
                </span>{" "}
                for continued usage.
              </span>
            )}
          </div>
        )}
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
