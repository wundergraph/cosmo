import {
  ChartTooltip,
  tooltipWrapperClassName,
} from "@/components/analytics/charts";
import { UserContext } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { calURL } from "@/lib/constants";
import { formatMetric } from "@/lib/format-metric";
import { NextPageWithLayout } from "@/lib/page";
import { getStripe } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createCheckoutSession,
  getBillingPlans,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetBillingPlansResponse_BillingPlan,
  GetBillingPlansResponse_BillingPlanFeature,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useContext } from "react";
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

const UsagesPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const { data, isLoading, error, refetch } = useQuery({
    ...getBillingPlans.useQuery(),
  });

  if (isLoading) return <Loader fullscreen />;
  console.log(data);
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

  const currentPlan = data.plans.find(
    ({ id }) => id == user?.currentOrganization.plan || "developer",
  );

  return (
    <div className="flex flex-col gap-y-4">
      <p className="mb-8">
        You are currently on the{" "}
        <Badge variant="outline">{currentPlan?.name}</Badge> plan.{" "}
        <Link href="">Contact sales</Link> for more information about our
        Enterprise plans.
      </p>

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
                  !!currentPlan?.price && currentPlan?.price > plan.price
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
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

  if (plan.price <= 0) {
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

UsagesPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Billing",
    "Manage your billing plan and payments",
  );
};

export default UsagesPage;
