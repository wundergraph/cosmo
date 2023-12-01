import { SideNav } from "./sidenav";

export interface LayoutProps {
  children?: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="mx-auto min-h-screen w-full bg-background font-sans antialiased">
      <SideNav />
      <main className="flex-1 pt-4 lg:pt-0">{children}</main>
    </div>
  );
};
