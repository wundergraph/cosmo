import { Logo } from '../logo';

export interface OnboardingLayoutProps {
  children?: React.ReactNode;
  title?: string;
}

export const OnboardingLayout = ({ children, title }: OnboardingLayoutProps) => {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background font-sans antialiased">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-6 py-4">
        <Logo width={32} height={32} />
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
      </header>
      <main className="flex w-full flex-1 items-center justify-center">
        <div className="w-full max-w-2xl px-6">{children}</div>
      </main>
    </div>
  );
};
