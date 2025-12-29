import { Arc } from "../auth/cosmo-stack";
import { Logo } from "../logo";

export interface LayoutProps {
  children?: React.ReactNode;
}

export const AuthLayout = ({ children }: LayoutProps) => {
  return (
    <div className="dark relative min-h-screen bg-gray-950">
      <div className="-z-1 pointer-events-none absolute inset-0 overflow-hidden">
        <div className="z-1 absolute top-0 h-[500px] w-full bg-gradient-to-br from-[#DB2777] to-[#4F2D71] opacity-5 blur-3xl dark:opacity-[0.2] dark:blur-[120px]" />

        <Arc className="xl:fade-x -z-9 absolute left-[40%] top-20 hidden overflow-visible lg:block 2xl:top-32" />
      </div>

      <header className="relative z-20 px-6 py-4">
        <div className="mx-auto max-w-screen-3xl">
          <a
            href="https://wundergraph.com"
            className="flex items-center gap-3 text-white"
          >
            <Logo width={36} height={36} />
            <h1 className="text-lg font-bold">WunderGraph Cosmo</h1>
          </a>
        </div>
      </header>
      <div className="mx-auto max-w-screen-2xl">{children}</div>
    </div>
  );
};
