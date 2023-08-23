import { Nav } from "./nav";

export interface LayoutProps {
  children?: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      <Nav>{children}</Nav>
    </div>
  );
};
