export interface LayoutProps {
  children?: React.ReactNode;
}

export const FullscreenLayout = ({ children }: LayoutProps) => {
  return (
    <div className="mx-auto min-h-screen w-full bg-background font-sans antialiased">
      <main className="flex-1 pt-4 lg:pt-0">{children}</main>
    </div>
  );
};
