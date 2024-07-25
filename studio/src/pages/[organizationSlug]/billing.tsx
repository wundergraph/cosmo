import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Toolbar } from "@/components/ui/toolbar";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentPlan } from "@/hooks/use-current-plan";
import { useSubscription } from "@/hooks/use-subscription";
import { useUser } from "@/hooks/use-user";
import { formatDate } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { getStripe } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { AlertDialogDescription } from "@radix-ui/react-alert-dialog";
import { useQuery, useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createBillingPortalSession,
  createCheckoutSession,
  getBillingPlans,
  upgradePlan,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GetBillingPlansResponse_BillingPlan } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import React, { useEffect } from "react";
import { PiCheck } from "react-icons/pi";

const billingContactLink = process.env.NEXT_PUBLIC_BILLING_CONTACT_LINK;

const getPrice = (price?: number) => {
  switch (price) {
    case 0:
      return "Free";
    case -1:
      return "Custom";
    default:
      return `$${price} / month`;
  }
};

const BillingPage: NextPageWithLayout = () => {
  const router = useRouter();
  const user = useUser();
  const { toast } = useToast();

  const { openPortal, isPending } = useBillingPortal();

  useEffect(() => {
    if (router.query.success) {
      toast({
        title: "Account upgraded",
        description:
          "Your payment was successful and your account has been upgraded.",
      });
    }
  }, [router.query.success, toast]);

  const { data, isLoading, error, refetch } = useQuery(getBillingPlans);

  const currentPlan = useCurrentPlan();

  const subscription = user?.currentOrganization.subscription;

  let alert;
  if (subscription?.status === "past_due") {
    alert = (
      <Alert variant="destructive">
        <AlertTitle>Payment required</AlertTitle>
        <AlertDescription>
          <p className="mb-2">
            Your payment is past due. Please update your payment method to
            continue using WunderGraph Cosmo.
          </p>
          <Button
            variant="destructive"
            onClick={() => openPortal()}
            disabled={isPending}
          >
            Update payment method
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading) return <Loader fullscreen />;

  if (error || data?.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve billing information"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  if (!data.plans.length) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="No billing information available"
        description="Please contact us."
      />
    );
  }

  return (
    <div className="flex flex-col gap-y-4">
      {alert}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((plan) => (
          <div
            key={plan.id}
            className={cn("flex flex-col gap-4 rounded-md border p-4")}
          >
            <div>
              <h4 className="text-sm">{plan.name}</h4>
              <p className="text-xl font-medium">{getPrice(plan.price)}</p>
            </div>
            <div className="space-y-1">
              {plan.features.map((feature) => (
                <div
                  key={feature.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <PiCheck className="h-4 w-4 text-green-400" />
                  <span className="text-muted-foreground">
                    {feature.description}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-auto flex flex-col">
              {billingContactLink && plan.price > 0 && (
                <div className="pb-6">
                  <a
                    href={billingContactLink}
                    target="_blank"
                    className="font-mono text-xs tracking-tight text-gray-200 underline decoration-dotted underline-offset-4 hover:text-gray-300"
                  >
                    Need a custom plan?
                  </a>
                </div>
              )}
              <UpgradeButton
                plan={plan}
                hasSubscription={
                  subscription && subscription?.status !== "canceled"
                }
                isCurrent={currentPlan?.id === plan.id}
                isDowngrade={
                  currentPlan?.price === -1 ||
                  (currentPlan?.price ? currentPlan?.price > plan.price : false)
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const useBillingPortal = () => {
  const router = useRouter();
  const { mutateAsync, isPending } = useMutation(createBillingPortalSession);

  const openPortal = async () => {
    if (isPending) return;

    try {
      const { url } = await mutateAsync({});
      router.push(url);
    } catch (e: any) {
      console.error(e);
    }
  };

  return {
    openPortal,
    isPending,
  };
};

const ManagePaymentButton = () => {
  const { openPortal, isPending } = useBillingPortal();

  const subscription = useSubscription();

  if (!subscription) return null;

  return (
    <Toolbar className="flex-nowrap py-0 lg:w-auto">
      <Button
        variant="outline"
        onClick={() => openPortal()}
        disabled={isPending}
      >
        Manage your payment settings
      </Button>
    </Toolbar>
  );
};

const SubscriptionStatus = () => {
  const subscription = useSubscription();
  const currentPlan = useCurrentPlan();

  let status;

  if (subscription?.status === "canceled") {
    status = "Your subscription has been canceled.";
  } else if (subscription?.status === "trialing") {
    status = (
      <>
        Your trial will end on{" "}
        <span className="font-medium text-foreground">
          {formatDate(new Date(subscription.trialEnd))}
        </span>
        .
      </>
    );
  } else if (subscription?.status === "active") {
    status = subscription.cancelAtPeriodEnd ? (
      <>
        Your subscription will end on{" "}
        <span className="font-medium text-foreground">
          {formatDate(new Date(subscription.currentPeriodEnd))}
        </span>
        .
      </>
    ) : (
      <>
        Your subscription will renew on{" "}
        <span className="font-medium text-foreground">
          {formatDate(new Date(subscription.currentPeriodEnd))}
        </span>
        .
      </>
    );
  }

  return (
    <span>
      You are currently on the{" "}
      <Badge variant="outline">{currentPlan?.name}</Badge> plan. {status}
    </span>
  );
};

const UpgradeButton = ({
  plan,
  hasSubscription,
  isCurrent,
  isDowngrade,
}: {
  plan: GetBillingPlansResponse_BillingPlan;
  hasSubscription?: boolean;
  isCurrent: boolean;
  isDowngrade?: boolean;
}) => {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { mutateAsync, isPending } = useMutation(createCheckoutSession);
  const { mutateAsync: upgradeAsync, isPending: isUpgrading } =
    useMutation(upgradePlan);

  const { toast } = useToast();

  const upgrade = async () => {
    try {
      if (hasSubscription) {
        setOpen(true);
        return;
      }

      const { sessionId } = await mutateAsync({ plan: plan.id });

      if (sessionId) {
        const stripe = await getStripe();
        await stripe?.redirectToCheckout({ sessionId });
      }
    } catch (e: any) {
      toast({
        description: e.message,
      });
    }
  };

  const confirmUpgrade = async () => {
    try {
      await upgradeAsync({ plan: plan.id });

      setOpen(false);

      toast({
        title: "Account upgraded",
        description: "Your account has been upgraded.",
      });

      router.push({
        pathname: router.pathname,
        query: {
          ...router.query,
          upgrade: "success",
        },
      });
    } catch (e: any) {
      toast({
        description: e.message,
      });
    }
  };

  if (isCurrent) {
    return (
      <Button variant="outline" disabled>
        Current plan
      </Button>
    );
  }

  if (plan.price === -1) {
    return <Button variant="secondary">Contact us</Button>;
  }

  if (isDowngrade) {
    return (
      <Button variant="secondary" disabled>
        Downgrade
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={isPending}
        onClick={() => upgrade()}
      >
        Upgrade
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Are you sure you want to upgrade?</AlertDialogTitle>
          <AlertDialogDescription>
            Your account will be upgraded immediately to the{" "}
            <strong>{plan.name}</strong> plan, and we will charge the price
            difference to your existing payment method.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="default"
              onClick={() => confirmUpgrade()}
              disabled={isUpgrading}
            >
              Upgrade
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

BillingPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Billing",
    <SubscriptionStatus />,
    undefined,
    <ManagePaymentButton />,
  );
};

export default BillingPage;
