import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useToast } from "@/components/ui/use-toast";
import { useUser } from "@/hooks/use-user";
import { formatDate } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import { getStripe } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createBillingPortalSession,
  createCheckoutSession,
  getBillingPlans,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GetBillingPlansResponse_BillingPlan } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import React, { useEffect } from "react";
import { PiCheck } from "react-icons/pi";

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

  const { data, isLoading, error, refetch } = useQuery({
    ...getBillingPlans.useQuery(),
  });

  const currentPlan = React.useMemo(
    () =>
      data?.plans.find(
        ({ id }) => id === user?.currentOrganization.billing?.plan,
      ) || data?.plans[0],
    [data?.plans, user?.currentOrganization.billing?.plan],
  );

  const subscription = user?.currentOrganization.subscription;

  let alert;
  if (1 == 1 || subscription?.status === "past_due") {
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

  return (
    <div className="flex flex-col gap-y-4">
      {alert ? (
        alert
      ) : (
        <p className="mb-8">
          You are currently on the{" "}
          <Badge variant="outline">{currentPlan?.name}</Badge> plan.{" "}
          <SubscriptionStatus subscription={subscription} />
        </p>
      )}

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
              <UpgradeButton
                plan={plan}
                isCurrent={currentPlan?.id === plan.id}
                isDowngrade={
                  currentPlan?.price ? currentPlan?.price > plan.price : false
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
  const { mutateAsync, isPending } = useMutation(
    createBillingPortalSession.useMutation(),
  );

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

const SubscriptionStatus = ({
  subscription,
}: {
  subscription?: {
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    trialEnd: string;
  };
}) => {
  const { openPortal, isPending } = useBillingPortal();

  if (!subscription) return null;

  let status;

  if (subscription.status === "canceled") {
    status = "Your subscription has been canceled.";
  } else if (subscription.status === "trialing") {
    status = (
      <>Your trial will end on {formatDate(new Date(subscription.trialEnd))}</>
    );
  } else if (subscription.status === "active") {
    status = subscription.cancelAtPeriodEnd ? (
      <>
        Your subscription will end on{" "}
        {formatDate(new Date(subscription.currentPeriodEnd))}
      </>
    ) : (
      <>
        Your subscription will renew on{" "}
        {formatDate(new Date(subscription.currentPeriodEnd))}
      </>
    );
  }

  return (
    <span>
      <Button
        variant="link"
        className="p-0 text-base"
        onClick={() => openPortal()}
        disabled={isPending}
      >
        Manage your payment settings
      </Button>
      . {status}
    </span>
  );
};

const UpgradeButton = ({
  plan,
  isCurrent,
  isDowngrade,
}: {
  plan: GetBillingPlansResponse_BillingPlan;
  isCurrent: boolean;
  isDowngrade?: boolean;
}) => {
  const { mutateAsync, isPending } = useMutation(
    createCheckoutSession.useMutation(),
  );

  const { toast } = useToast();

  const upgrade = async () => {
    try {
      const { sessionId } = await mutateAsync({ plan: plan.id });

      if (sessionId) {
        const stripe = await getStripe();
        stripe?.redirectToCheckout({ sessionId });
      }
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
    <Button variant="secondary" disabled={isPending} onClick={() => upgrade()}>
      Upgrade
    </Button>
  );
};

BillingPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Billing",
    "Manage your billing plan and payments",
  );
};

export default BillingPage;
