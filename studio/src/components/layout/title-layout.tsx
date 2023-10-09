import { cn } from "@/lib/utils";
import { useRouter } from "next/router";
import { useContext, useEffect, useRef } from "react";
import { UserContext } from "../app-provider";
import { Separator } from "../ui/separator";

export const TitleLayout = ({
  title,
  subtitle,
  items,
  toolbar,
  children,
}: {
  title: string;
  subtitle: string;
  items?: React.ReactNode;
  toolbar?: React.ReactNode;
  children?: React.ReactNode;
}) => {
  const router = useRouter();
  const user = useContext(UserContext);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const className = cn("h-auto flex-1 px-4 py-4", {
      "pointer-events-none blur-lg":
        user?.currentOrganization.isFreeTrialExpired,
    });

    ref.current.className = className;
  }, [router.asPath, user?.currentOrganization.isFreeTrialExpired]);

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn("sticky top-0 z-10 bg-background md:top-6 lg:top-0", {
          "lg:top-8": user?.currentOrganization.isFreeTrial,
        })}
      >
        <div className="flex flex-col justify-between gap-y-4 px-4 pt-4 lg:flex-row lg:items-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>
          {items}
        </div>
        <Separator className="mt-4" />
        {toolbar}
      </div>
      <div ref={ref}>{children}</div>
    </div>
  );
};
