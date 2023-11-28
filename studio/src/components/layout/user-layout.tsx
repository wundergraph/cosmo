import { useRouter } from "next/router";
import { useMemo } from "react";
import { AiOutlineMail } from "react-icons/ai";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { Nav, NavLink } from "./nav";
import { TitleLayout } from "./title-layout";

export const UserLayout = ({ children }: LayoutProps) => {
  const links: NavLink[] = useMemo(() => {
    return [
      {
        title: "Invitations",
        href: "/account/invitations",
        icon: <AiOutlineMail />,
      },
    ];
  }, []);

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <div className="min-h-screen w-full max-w-screen-4xl bg-background font-sans antialiased">
        <Nav links={links} isUserLayout>
          {children}
        </Nav>
      </div>
    </div>
  );
};

export const getUserLayout = (
  page: React.ReactNode,
  title: string,
  subtitle: string,
  items?: React.ReactNode,
) => {
  return (
    <UserLayout>
      <PageHeader title={`User | ${title}`}>
        <TitleLayout title={title} subtitle={subtitle} items={items}>
          {page}
        </TitleLayout>
      </PageHeader>
    </UserLayout>
  );
};
