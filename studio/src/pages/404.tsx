import { EmptyState } from "@/components/empty-state";
import { FullscreenLayout } from "@/components/layout/fullscreen-layout";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { NextPageWithLayout } from "@/lib/page";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect } from "react";

const FourOhFour: NextPageWithLayout = () => {
  const router = useRouter();

  useEffect(() => {
    let t: NodeJS.Timeout;
    t = setTimeout(() => {
      router.replace("/");
    }, 3000);

    return () => {
      clearTimeout(t);
    };
  });

  return (
    <div className="flex h-screen items-center justify-center">
      <svg
        width="855"
        height="323"
        viewBox="0 0 855 323"
        fill="none"
        className="absolute hidden md:block md:scale-50 lg:scale-75"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath="url(#clip0_702_186)">
          <path
            opacity="0.06"
            d="M0.5 261.289H150.146V316.093H213.171V261.289H251.838V208.464H213.171V4.3186H130.66L0.5 209.377V261.289ZM151.364 208.464H66.8739V206.028L148.928 76.173H151.364V208.464Z"
            className="fill-gray-700 dark:fill-white"
          />
          <path
            opacity="0.06"
            d="M426.575 322.944C504.975 322.944 552.32 263.268 552.472 160.51C552.624 58.5138 504.671 0.0560303 426.575 0.0560303C348.327 0.0560303 300.83 58.3615 300.678 160.51C300.373 262.964 348.022 322.792 426.575 322.944ZM426.575 268.292C390.8 268.292 367.66 232.365 367.813 160.51C367.965 89.7217 390.952 54.099 426.575 54.099C462.045 54.099 485.185 89.7217 485.185 160.51C485.337 232.365 462.198 268.292 426.575 268.292Z"
            className="fill-gray-700 dark:fill-white"
          />
          <path
            opacity="0.06"
            d="M603.329 261.289H752.975V316.093H816V261.289H854.667V208.464H816V4.3186H733.489L603.329 209.377V261.289ZM754.193 208.464H669.703V206.028L751.757 76.173H754.193V208.464Z"
            className="fill-gray-700 dark:fill-white"
          />
        </g>
        <defs>
          <clipPath id="clip0_702_186">
            <rect
              width="854.167"
              height="322.888"
              fill="white"
              transform="translate(0.5 0.0560303)"
            />
          </clipPath>
        </defs>
      </svg>
      <EmptyState
        icon={
          <div className="md:hidden">
            <Logo height={50} width={50} />
          </div>
        }
        title="Page not found"
        description="Redirecting you back to home in 3 seconds..."
        className="z-50 md:-mt-8"
        actions={
          <Button asChild>
            <Link href="/">Take me home</Link>
          </Button>
        }
      />
    </div>
  );
};

FourOhFour.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};

export default FourOhFour;
