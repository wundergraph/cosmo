import { FullscreenLayout } from "@/components/layout/fullscreen-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useUser } from "@/hooks/use-user";
import { NextPageWithLayout } from "@/lib/page";
import { getStripe } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  CheckIcon,
} from "@radix-ui/react-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createOrganization,
  getBillingPlans,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
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

import { z } from "zod";

const CreateOrganization: NextPageWithLayout = () => {
  return (
    <div>
      <div className="mb-20 flex h-16 items-center border-b px-4 lg:px-8">
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeftIcon className="mr-2" /> Back
          </Link>
        </Button>
      </div>
      <div className="mx-auto max-w-screen-md">
        <Card>
          <CardHeader>
            <CardTitle>Create organization</CardTitle>
          </CardHeader>
          <CardContent>
            <OrganizationForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const OrganizationForm = () => {
  const user = useUser();
  const router = useRouter();

  type OrganizationDetailsInput = z.infer<typeof schema>;

  const { data: billing, isLoading } = useQuery(getBillingPlans.useQuery());

  const availablePlans = billing?.plans?.filter(({ price }) => price > 0) || [];

  const plan = availablePlans.length ? z.string() : z.string().optional();

  const schema = z.object({
    name: z
      .string()
      .min(3, {
        message: "Organization name must be a minimum of 3 characters",
      })
      .max(32, { message: "Organization name must be maximum 32 characters" }),
    slug: z
      .string()
      .toLowerCase()
      .regex(
        new RegExp("^[a-z0-9]+(?:-[a-z0-9]+)*$"),
        "Slug should start and end with an alphanumeric character. Spaces and special characters other that hyphen not allowed.",
      )
      .min(3, {
        message: "Organization slug must be a minimum of 3 characters",
      })
      .max(24, { message: "Organization slug must be maximum 24 characters" })
      .refine(
        (value) => !["login", "signup", "create"].includes(value),
        "This slug is a reserved keyword",
      ),
    plan,
  });

  const form = useZodForm<OrganizationDetailsInput>({
    schema,
    mode: "onChange",
  });

  const { mutate, isPending } = useMutation(createOrganization.useMutation());

  const { toast } = useToast();

  const onSubmit: SubmitHandler<OrganizationDetailsInput> = (data) => {
    mutate(
      {
        name: data.name,
        slug: data.slug,
        plan: data.plan,
      },
      {
        onSuccess: async (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            if (d.stripeSessionId) {
              const stripe = await getStripe();
              stripe?.redirectToCheckout({ sessionId: d.stripeSessionId });
              return;
            }
            router.replace(`/${data.slug}`);
            toast({
              title: "Organization created",
              description: "Your organization has been created.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: (error) => {
          toast({
            description:
              "Could not create the organization details. Please try again.",
            duration: 3000,
          });
        },
      },
    );
  };

  if (isLoading) {
    return null;
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          defaultValue=""
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoFocus
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    field.onChange(e);
                    form.setValue(
                      "slug",
                      value
                        .toLowerCase()
                        .replaceAll(/[^a-zA-Z0-9 -]/g, "")
                        .replaceAll(/\s+/g, "-"),
                      {
                        shouldValidate: true,
                      },
                    );
                  }}
                />
              </FormControl>
              <FormDescription>
                This is the visible name of your organization within WunderGraph
                Cosmo.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          defaultValue=""
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization slug</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>
                This is the URL namespace of the organization within WunderGraph
                Cosmo.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isLoading && availablePlans?.length ? (
          <FormField
            control={form.control}
            name="plan"
            defaultValue={availablePlans?.[0]?.id}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Plan</FormLabel>
                <FormDescription>
                  Select a plan for your organization.{" "}
                  <Link
                    href="https://wundergraph.com/pricing"
                    target="_blank"
                    className="text-foreground hover:underline"
                  >
                    Pricing information
                  </Link>
                </FormDescription>
                <FormControl>
                  <div className="flex flex-row gap-2">
                    {availablePlans.map((plan) => (
                      <Card
                        key={plan.id}
                        className={cn(
                          "relative flex-1 cursor-pointer hover:border-border-emphasized",
                          {
                            "border-border-emphasized": plan.id === field.value,
                          },
                        )}
                        onClick={() => form.setValue("plan", plan.id)}
                      >
                        <CardHeader>
                          <CardTitle>
                            <span className="block text-sm font-normal text-muted-foreground">
                              {plan.name}
                            </span>
                            <span>{getPrice(plan.price)}</span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {plan.id === field.value && (
                            <CheckCircledIcon className="absolute right-4 top-4 h-6 w-6 text-pink-500" />
                          )}
                          {plan.features
                            .filter(({ description }) => !!description)
                            .map((feature) => {
                              return (
                                <div
                                  key={feature.id}
                                  className="flex flex-row items-center gap-2"
                                >
                                  <PiCheck className="h-4 w-4 text-green-400" />
                                  <span className="text-sm text-muted-foreground">
                                    {feature.description}
                                  </span>
                                </div>
                              );
                            })}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </FormControl>
                <FormDescription>
                  Looking for enterprise plans?{" "}
                  <Link
                    href="https://cal.com/stefan-avram-wundergraph/wundergraph-introduction?duration=30"
                    target="_blank"
                    className="text-foreground hover:underline"
                  >
                    Please contact sales
                  </Link>
                </FormDescription>
              </FormItem>
            )}
          />
        ) : null}

        <Button
          className="ml-auto"
          isLoading={isPending}
          type="submit"
          disabled={
            !form.formState.isValid ||
            !user?.currentOrganization.roles.includes("admin")
          }
        >
          {availablePlans?.length
            ? "Continue to payment"
            : "Create organization"}
        </Button>
      </form>
    </Form>
  );
};

CreateOrganization.getLayout = (page) => {
  return <FullscreenLayout>{page}</FullscreenLayout>;
};

export default CreateOrganization;
