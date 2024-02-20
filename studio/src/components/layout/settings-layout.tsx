import { useRouter } from "next/router";
import { useMemo } from "react";
import { FiBell, FiUsers, FiKey, FiSliders } from "react-icons/fi";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { SideNav, NavLink } from "./sidenav";
import { TitleLayout } from "./title-layout";

export const SettingsLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;

  const links: NavLink[] = useMemo(() => {
    const basePath = `/${organizationSlug}`;

    return [
      {
        title: "General",
        href: basePath + "/settings",
        icon: <FiSliders />,
      },
      {
        title: "Members",
        href: basePath + "/settings/members",
        icon: <FiUsers />,
      },
      {
        title: "API Keys",
        href: basePath + "/settings/apikeys",
        icon: <FiKey />,
      },
      {
        title: "Notifications",
        href: basePath + "/settings/webhooks",
        icon: <FiBell />,
      },
    ];
  }, [organizationSlug]);

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <div className="flex min-h-screen w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:grid-cols-[auto_minmax(10px,1fr)] lg:divide-x">
        <SideNav links={links}>{children}</SideNav>
        <main className="flex-1 pt-4 lg:pt-0">{children}</main>
      </div>
    </div>
  );
};

export const getSettingsLayout = (
  page: React.ReactNode,
  title: string,
  subtitle: string,
  items?: React.ReactNode,
  toolbar?: React.ReactNode,
) => {
  return (
    <SettingsLayout>
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
    </SettingsLayout>
  );
};
