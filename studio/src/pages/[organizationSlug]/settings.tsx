import { UserContext } from "@/components/app-provider";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  deleteOrganization,
  leaveOrganization,
  updateOrganizationDetails,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { z } from "zod";

const OrganizationDetails = () => {
  const user = useContext(UserContext);
  const router = useRouter();

  const schema = z.object({
    organizationName: z
      .string()
      .min(3, {
        message: "Organization name must be a minimum of 3 characters",
      })
      .max(32, { message: "Organization name must be maximum 32 characters" }),
    organizationSlug: z
      .string()
      .min(3, {
        message: "Organization slug must be a minimum of 3 characters",
      })
      .max(24, { message: "Organization slug must be maximum 24 characters" }),
  });

  type OrganizationDetailsInput = z.infer<typeof schema>;

  const form = useZodForm<OrganizationDetailsInput>({
    schema,
    mode: "onChange",
  });

  const { mutate, isLoading } = useMutation(
    updateOrganizationDetails.useMutation()
  );

  const { toast } = useToast();

  const onSubmit: SubmitHandler<OrganizationDetailsInput> = (data) => {
    mutate(
      {
        userID: user?.id,
        organizationName: data.organizationName,
        organizationSlug: data.organizationSlug,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.replace(`/${data.organizationSlug}/settings`);
            toast({
              description: "Organization details updated successfully.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: (error) => {
          toast({
            description:
              "Could not update the organization details. Please try again.",
            duration: 3000,
          });
        },
      }
    );
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-y-4"
      >
        <FormField
          control={form.control}
          name="organizationName"
          defaultValue={user?.currentOrganization.name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization Name</FormLabel>
              <FormControl>
                <Input {...field} />
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
          name="organizationSlug"
          defaultValue={user?.currentOrganization.slug}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization Slug</FormLabel>
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
        <Button
          className="ml-auto"
          isLoading={isLoading}
          type="submit"
          disabled={
            !form.formState.isValid ||
            !user?.currentOrganization.roles.includes("admin")
          }
        >
          Save
        </Button>
      </form>
    </Form>
  );
};

const LeaveOrganization = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { mutate, isLoading } = useMutation(leaveOrganization.useMutation());

  const { toast } = useToast();

  const handleLeaveOrg = () => {
    mutate(
      {
        userID: user?.id,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.reload();
            toast({
              description: "Left the organization successfully.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 4000 });
          }
        },
        onError: (error) => {
          toast({
            description: "Could not leave the organization. Please try again.",
            duration: 3000,
          });
        },
      }
    );
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Leave Organization</CardTitle>
          <CardDescription>
            Revokes your access to this organization.
          </CardDescription>
        </div>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button className="md:ml-auto" type="submit" variant="secondary">
              Leave organization
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Are you sure you want to leave this organization?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                type="button"
                onClick={handleLeaveOrg}
              >
                Leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
    </Card>
  );
};

const DeleteOrganization = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const regex = new RegExp(`^${user?.currentOrganization.name}$`);
  const schema = z.object({
    organizationName: z.string().regex(regex, {
      message: "Please enter the organization name as requested.",
    }),
  });

  type DeleteOrgInput = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useZodForm<DeleteOrgInput>({
    schema,
    mode: "onChange",
  });

  const { mutate, isLoading } = useMutation(deleteOrganization.useMutation());

  const { toast } = useToast();

  const handleDeleteOrg = () => {
    mutate(
      {
        userID: user?.id,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.reload();
            toast({
              description: "Deleted the organization succesfully.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: (error) => {
          toast({
            description: "Could not delete the organization. Please try again.",
            duration: 3000,
          });
        },
      }
    );
    setOpen(false);
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle>Delete Organization</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          The organization will be permanently deleted. This action is
          irreversible and can not be undone.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Dialog
          open={
            user?.currentOrganization.roles.includes("admin") ? open : false
          }
          onOpenChange={setOpen}
        >
          <DialogTrigger
            className={cn({
              "cursor-not-allowed":
                !user?.currentOrganization.roles.includes("admin"),
            })}
            asChild
          >
            <Button
              type="submit"
              variant="destructive"
              className="w-full md:ml-auto md:w-max"
              disabled={!user?.currentOrganization.roles.includes("admin")}
            >
              Delete organization
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Are you sure you want to delete this organization?
              </DialogTitle>
              <span className="text-sm text-muted-foreground">
                This action cannot be undone.
              </span>
            </DialogHeader>
            <form onSubmit={handleSubmit(handleDeleteOrg)} className="mt-2">
              <div className="flex flex-col gap-y-3">
                <span className="text-sm">
                  Enter <strong>{user?.currentOrganization.name}</strong> to
                  confirm you want to delete this organization.
                </span>
                <Input
                  type="text"
                  {...register("organizationName")}
                  autoFocus={true}
                />
                {errors.organizationName && (
                  <span className="px-2 text-xs text-destructive">
                    {errors.organizationName.message}
                  </span>
                )}
                <div className="mt-2 flex justify-end gap-x-4">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    isLoading={isLoading}
                    type="submit"
                    disabled={!isValid}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
};

const SettingsDashboardPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);

  return (
    <div className="flex flex-col gap-y-4">
      <OrganizationDetails />
      {user && !user.currentOrganization.isPersonal && (
        <>
          <Separator className="my-2" />
          <LeaveOrganization />
          <DeleteOrganization />
        </>
      )}
    </div>
  );
};

SettingsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Settings",
    "Settings for this organization."
  );
};

export default SettingsDashboardPage;
