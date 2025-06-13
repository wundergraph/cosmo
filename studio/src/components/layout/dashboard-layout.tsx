import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { useQuery } from "@connectrpc/connect-query";
import {
  Component2Icon,
  Cross1Icon,
  EnvelopeClosedIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";
import { getBillingPlans } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { addDays } from "date-fns";
import { useRouter } from "next/router";
import { Dispatch, SetStateAction, useMemo } from "react";
import { AiOutlineAudit } from "react-icons/ai";
import { MdOutlineFeaturedPlayList, MdOutlinePolicy } from "react-icons/md";
import {
  PiBell,
  PiChartDonut,
  PiGear,
  PiGraphLight,
  PiKey,
  PiReceipt,
  PiUserGear,
  PiUsers,
  PiWebhooksLogo,
} from "react-icons/pi";
import { PageHeader } from "./head";
import { LayoutProps } from "./layout";
import { NavLink, SideNav } from "./sidenav";
import { TitleLayout } from "./title-layout";
import { FaGripfire } from "react-icons/fa";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useUser } from "@/hooks/use-user";
import { useStarBannerDisabled } from "@/hooks/use-star-banner-disabled";

export const StarBanner = ({
  isDisabled,
  setDisableStarBanner,
}: {
  isDisabled: boolean;
  setDisableStarBanner: Dispatch<SetStateAction<string>>;
}) => {
  return (
    <div className={cn("flex h-8 justify-center", isDisabled && "hidden")}>
      <div className="flex w-screen bg-gradient-to-r from-purple-500 to-pink-400 text-xs lg:justify-center xl:text-sm">
        <a
          href="//github.com/wundergraph/cosmo"
          className="z-10 flex h-full items-center justify-between px-4 py-1.5"
          target="_blank"
          rel="noreferrer"
        >
          <span className="flex items-center gap-x-2">
            <span className="relative hidden h-3 w-3 md:flex">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-400 opacity-75 dark:bg-white"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-pink-400 dark:bg-white"></span>
            </span>
            <span className="flex gap-x-1 text-gray-950 dark:text-slate-100">
              If you like WunderGraph Cosmo,{" "}
              <span className="font-bold ">give it a star on GitHub! </span>
              <span className="hidden font-bold lg:flex">⭐️</span>
            </span>
          </span>
        </a>
        <div
          onClick={() => {
            setDisableStarBanner("true");
          }}
          className="absolute right-3 top-2 cursor-pointer"
        >
          <Cross1Icon />
        </div>
      </div>
    </div>
  );
};

export const OrganizationBanner = () => {
  const org = useCurrentOrganization();

  if (!org?.deactivation && !org?.deletion) {
    return null;
  }

  return (
    <div className="flex w-full bg-destructive text-xs lg:justify-center xl:text-sm">
      <p className="flex items-center gap-x-2 px-4 py-2">
        <ExclamationTriangleIcon className="flex-shrink-0" />
        <span className="flex gap-x-1 font-bold text-gray-950 dark:text-primary-foreground">
          {org.deactivation
            ? (
              <>
                Your organization is deactivated and is in read-only mode.{" "}
                {org.deactivation.reason ? `${org.deactivation.reason}.` : ""} It will
                be permanently deleted on{" "}
                {formatDateTime(addDays(new Date(org.deactivation.initiatedAt), 30))}
              </>
            )
            : (
              <>
                Your organization is queued for deletion. It will be permanently deleted on{" "}
                {formatDateTime(addDays(new Date(org.deletion!.queuedAt), 3))}
              </>
            )}
        </span>
      </p>
    </div>
  );
};

export const DashboardLayout = ({ children }: LayoutProps) => {
  const router = useRouter();
  const user = useUser();
  const organizationSlug = router.query.organizationSlug as string;
  const checkUserAccess = useCheckUserAccess();
  const [isStarBannerDisabled, setDisableStarBanner] = useStarBannerDisabled();

  const isAdmin = checkUserAccess({ rolesToBe: ["organization-admin" ]});
  const isAdminOrDeveloper = checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] });
  const isApiKeyManager = checkUserAccess({ rolesToBe: ["organization-apikey-manager"] });
  const isOrganizationDeactivated = !!user?.currentOrganization.deactivation;
  const isOrganizationPendingDeletion = !!user?.currentOrganization?.deletion;

  const isBannerDisplayed = isOrganizationDeactivated || isOrganizationPendingDeletion || !isStarBannerDisabled;

  const plans = useQuery(
    getBillingPlans,
    {},
    {
      gcTime: Infinity,
    },
  );

  const links = useMemo(() => {
    const basePath = `/${user?.currentOrganization.slug || organizationSlug}`;

    const navigation: Partial<NavLink>[] = [
      {
        title: "Graphs",
        href: basePath + "/graphs",
        icon: <PiGraphLight className="size-4" />,
      },
      {
        title: "Subgraphs",
        href: basePath + "/subgraphs",
        icon: <Component2Icon className="size-4" />,
      },
      {
        title: "Feature Flags",
        href: basePath + "/feature-flags",
        icon: <MdOutlineFeaturedPlayList className="size-4" />,
        matchExact: false,
        separator: !isAdminOrDeveloper,
      },
    ];

    if (isAdminOrDeveloper) {
      navigation.push(
        {
          title: "Policies",
          href: basePath + "/policies",
          icon: <MdOutlinePolicy className="size-4" />,
        },
        {
          title: "Cache Warmer",
          href: basePath + "/cache-warmer",
          icon: <FaGripfire className="size-4" />,
          separator: true,
        },
      );
    }

    navigation.push(
      {
        title: "Members",
        href: basePath + "/members",
        icon: <PiUsers className="size-4" />,
      },
      {
        title: "Groups",
        href: basePath + "/groups",
        icon: <UserGroupIcon className="size-4" />,
      },
    );

    if (isAdminOrDeveloper || isApiKeyManager) {
      navigation.push({
        title: "API Keys",
        href: basePath + "/apikeys",
        icon: <PiKey className="size-4" />,
      });
    }

    if (isAdminOrDeveloper) {
      navigation.push(
        {
          title: "Notifications",
          href: basePath + "/webhooks",
          icon: <PiBell className="size-4" />,
        },
        {
          title: "Webhook History",
          href: basePath + "/webhook-history",
          icon: <PiWebhooksLogo className="size-4" />,
        },
        {
          title: "Usage",
          href: basePath + "/usages",
          icon: <PiChartDonut className="size-4" />,
        },
      );
    }

    if (
      plans.data?.plans?.length &&
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
      isAdmin
    ) {
      navigation.push({
        title: "Billing",
        href: basePath + "/billing",
        icon: <PiReceipt className="size-4" />,
      });
    }

    if (isAdmin) {
      navigation.push({
        title: "Audit log",
        href: basePath + "/audit-log",
        icon: <AiOutlineAudit className="size-4"/>,
        separator: !isAdminOrDeveloper,
      });
    }

    if (isAdminOrDeveloper) {
      navigation.push({
        title: "Settings",
        href: basePath + "/settings",
        icon: <PiGear className="size-4" />,
        separator: true,
      });
    }

    navigation.push(
      {
        title: "Account",
      },
      {
        title: "Invitations",
        href: "/account/invitations",
        icon: <EnvelopeClosedIcon className="size-4" />,
      },
      {
        title: "Manage",
        href: "/account/manage",
        icon: <PiUserGear className="size-4" />,
      },
    );

    return navigation;
  }, [
    organizationSlug,
    plans.data?.plans?.length,
    user?.currentOrganization.slug,
    isAdmin,
    isAdminOrDeveloper,
  ]);

  return (
    <div className="2xl:flex 2xl:flex-1 2xl:flex-col 2xl:items-center">
      <StarBanner
        isDisabled={isStarBannerDisabled}
        setDisableStarBanner={setDisableStarBanner}
      />
      <OrganizationBanner />
      <div
        className={cn(
          "flex w-full flex-1 flex-col bg-background font-sans antialiased lg:grid lg:grid-cols-[auto_minmax(10px,1fr)] lg:divide-x",
          {
            "min-h-[calc(100vh-36px)]": isBannerDisplayed,
            "min-h-screen": !isBannerDisplayed,
          },
        )}
      >
        <SideNav links={links} isBannerDisplayed={isBannerDisplayed}>
          {children}
        </SideNav>
        <main className="flex-1 lg:pt-0">{children}</main>
      </div>
    </div>
  );
};

export const getDashboardLayout = (
  page: React.ReactNode,
  title: string,
  subtitle: React.ReactNode,
  items?: React.ReactNode,
  toolbar?: React.ReactNode,
  breadcrumbs?: React.ReactNode[],
  noPadding?: boolean,
) => {
  return (
    <DashboardLayout>
      <PageHeader title={`Dashboard | ${title}`}>
        <TitleLayout
          title={title}
          subtitle={subtitle}
          items={items}
          toolbar={toolbar}
          breadcrumbs={breadcrumbs}
          noPadding={noPadding}
        >
          {page}
        </TitleLayout>
      </PageHeader>
    </DashboardLayout>
  );
};
