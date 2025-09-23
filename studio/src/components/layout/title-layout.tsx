import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { cn } from "@/lib/utils";
import { Fragment } from "react";
import { useStarBannerDisabled } from "@/hooks/use-star-banner-disabled";

export interface TitleLayoutProps {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  items?: React.ReactNode;
  toolbar?: React.ReactNode;
  noPadding?: boolean;
  children?: React.ReactNode;
  breadcrumbs?: React.ReactNode[];
}

export const TitleLayout = ({
  title,
  subtitle,
  items,
  toolbar,
  noPadding,
  children,
  breadcrumbs,
}: TitleLayoutProps) => {
  const org = useCurrentOrganization();

  const [isStarBannerDisabled] = useStarBannerDisabled();
  const isOrganizationDeactivated = !!org?.deactivation;
  const isOrganizationPendingDeletion = !!org?.deletion;
  const isBannerDisplayed = isOrganizationDeactivated || isOrganizationPendingDeletion || !isStarBannerDisabled;

  return (
    <div
      className={cn("flex flex-col", {
        "h-[calc(100vh_-_140px)] lg:h-[calc(100vh_-_36px)]": isBannerDisplayed,
        "h-[calc(100vh_-_108px)] lg:h-screen": !isBannerDisplayed,
      })}
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-4 border-b bg-background py-4">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <div
            className={cn(
              "flex w-full flex-col justify-between gap-y-4 px-4 md:w-auto lg:flex-row lg:items-center lg:px-6 xl:px-8",
            )}
          >
            <div className="flex flex-row items-center space-x-2 text-sm h-9">
              {breadcrumbs?.map((b, i) => (
                <Fragment key={i}>
                  <span className="text-muted-foreground hover:text-current">
                    {b}
                  </span>
                  <span className="text-muted-foreground">/</span>
                </Fragment>
              ))}
              <h1 className="truncate whitespace-nowrap font-medium">
                {title}
              </h1>
            </div>
            {items}
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col justify-between gap-y-4 px-4 lg:flex-row lg:items-center lg:px-8",
            )}
          >
            <div>
              <h1 className="text-lg font-semibold">{title}</h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {items}
          </div>
        )}
        {toolbar}
      </div>
      <div
        className={cn(
          "scrollbar-custom h-auto flex-1 overflow-y-auto",
          noPadding !== true && "px-4 py-4 lg:px-8 lg:py-6",
        )}
      >
        {children}
      </div>
    </div>
  );
};
