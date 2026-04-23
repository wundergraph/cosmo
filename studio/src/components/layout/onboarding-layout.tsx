export interface OnboardingLayoutProps {
  children?: React.ReactNode;
}

export const OnboardingLayout = ({ children }: OnboardingLayoutProps) => {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background font-sans antialiased">
      <main className="w-full max-w-lg px-4">{children}</main>
    </div>
  );
};
