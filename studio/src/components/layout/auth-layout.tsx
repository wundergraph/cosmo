export interface LayoutProps {
  children?: React.ReactNode;
}

export const AuthLayout = ({ children }: LayoutProps) => {
  return (
    <div className="dark fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-[linear-gradient(145.58deg,#0A050F_20.33%,#270B21_80.1%)]">
      {/* Background image overlay */}
      <div className="pointer-events-none absolute inset-0 z-0 bg-[url('/login/auth-bg.png')] bg-cover bg-center bg-no-repeat lg:bg-right-bottom" />

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </div>
  );
};
