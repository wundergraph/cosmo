export interface OnboardingLayoutProps {
  children?: React.ReactNode;
}

export const OnboardingLayout = ({ children }: OnboardingLayoutProps) => {
  return (
    <div className="mx-auto min-h-screen w-full bg-background font-sans antialiased">
      <main className="flex-1">{children}</main>
    </div>
  );
};
