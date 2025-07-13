import { Logo } from "@/components/logo";
import { ProductCosmoStack, Arc } from "@/components/auth/cosmo-stack";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="dark relative min-h-screen bg-gray-950">
      <div className="-z-1 pointer-events-none absolute inset-0 overflow-hidden">
        <div className="z-1 absolute top-0 h-[500px] w-full bg-gradient-to-br from-[#DB2777] to-[#4F2D71] opacity-5 blur-3xl dark:opacity-[0.2] dark:blur-[120px]" />
        
        <Arc className="xl:fade-x -z-9 absolute left-[40%] top-20 hidden overflow-visible lg:block 2xl:top-32" />
      </div>

      <div className="mx-auto max-w-screen-2xl">
        <div className="flex min-h-screen items-center justify-center xl:items-start xl:justify-start">
          <div className="relative z-10 m-4 flex w-full max-w-xl flex-col gap-y-4 rounded-lg border bg-gray-950/60 p-4 text-white shadow-xl backdrop-blur-xl md:p-10 lg:m-10 lg:mt-20 xl:mt-52 2xl:mt-60">
            <a href="https://wundergraph.com" className="flex items-center gap-2">
              <Logo width={40} height={40} />
              <h1 className="text-lg font-bold">WunderGraph Cosmo</h1>
            </a>
            <div className="flex flex-col items-start pt-8 md:pt-16">
              {children}
            </div>
          </div>
          <div className="relative hidden flex-1 flex-col items-center gap-y-4 text-center text-white xl:flex xl:pt-40 2xl:pt-52">
            <ProductCosmoStack />
          </div>
        </div>
      </div>
    </div>
  );
} 
