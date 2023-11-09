import { Arc } from "../auth/cosmo-stack";

export interface LayoutProps {
  children?: React.ReactNode;
}

export const AuthLayout = ({ children }: LayoutProps) => {
  return (
    <div className="dark relative min-h-screen bg-gray-950">
      <div className="-z-1 pointer-events-none absolute inset-0 overflow-hidden">
        <div className="z-1 absolute top-0 h-[500px] w-full bg-gradient-to-br from-[#DB2777] to-[#4F2D71] opacity-5 blur-3xl dark:opacity-[0.2] dark:blur-[120px]" />

        <Arc className="xl:fade-x -z-9 absolute left-[40%] top-32 hidden overflow-visible lg:block" />
      </div>

      <div className="mx-auto max-w-screen-2xl">{children}</div>
    </div>
  );
};
