import { Nav } from "./nav";

export interface LayoutProps {
  children?: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="mx-auto min-h-screen w-full max-w-screen-4xl bg-background font-sans antialiased">
      <Nav>{children}</Nav>
    </div>
  );
};
