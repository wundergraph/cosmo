import { UserContext } from "@/components/app-provider";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  deleteOrganization,
  leaveOrganization,
  updateOrganizationName,
  updateOrganizationSlug,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { z } from "zod";

const OrganizationName = () => {
  const [user] = useContext(UserContext);
  const router = useRouter();

  const schema = z.object({
    organizationName: z
      .string()
      .min(3, {
        message: "Organization name must be a minimum of 3 characters",
      })
      .max(32, { message: "Organization name must be maximum 32 characters" }),
  });

  type OrganizationNameInput = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useZodForm<OrganizationNameInput>({
    schema,
    mode: "onChange",
  });

  const { mutate, isLoading } = useMutation(
    updateOrganizationName.useMutation()
  );

  const { toast } = useToast();

  const handleChangeOrgName: SubmitHandler<OrganizationNameInput> = (data) => {
    mutate(
      {
        userID: user?.id,
        organizationName: data.organizationName,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.reload();
            toast({
              description: "Organization name updated succesfully.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: (error) => {
          toast({
            description: "Could not update the organization name. Please try again.",
            duration: 3000,
          });
        },
      }
    );
  };

  return (
    <Card className="flex flex-col gap-y-2 p-4">
      <h1 className="text-lg font-semibold text-primary-foreground">
        Organization Name
      </h1>
      <p className="text-sm text-muted-foreground">
        {`This is your organization's visible name within WunderGraph Cosmo. For
        example, the name of your company or department.`}
      </p>

      <form onSubmit={handleSubmit(handleChangeOrgName)} className="mt-4">
        <div className="flex flex-col gap-y-2">
          <Input
            type="text"
            defaultValue={user?.currentOrganization.name}
            {...register("organizationName")}
          />
          {errors.organizationName && (
            <span className="px-2 text-xs text-destructive">
              {errors.organizationName.message}
            </span>
          )}
          <div className="mt-2 flex justify-end">
            <Button
              variant="default"
              isLoading={isLoading}
              type="submit"
              disabled={
                !isValid || !user?.currentOrganization.roles.includes("admin")
              }
            >
              Save
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
};

const OrganizationSlug = () => {
  const [user] = useContext(UserContext);
  const router = useRouter();

  const schema = z.object({
    organizationSlug: z
      .string()
      .min(3, {
        message: "Organization name must be a minimum of 3 characters",
      })
      .max(24, { message: "Organization name must be maximum 24 characters" }),
  });

  type OrganizationSlugInput = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useZodForm<OrganizationSlugInput>({
    schema,
    mode: "onChange",
  });

  const { mutate, isLoading } = useMutation(
    updateOrganizationSlug.useMutation()
  );

  const { toast } = useToast();

  const handleChangeOrgSlug: SubmitHandler<OrganizationSlugInput> = (data) => {
    mutate(
      {
        userID: user?.id,
        organizationSlug: data.organizationSlug,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            router.reload();
            toast({
              description: "Organization slug updated succesfully.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: (error) => {
          toast({
            description: "Could not update the organization slug. Please try again.",
            duration: 3000,
          });
        },
      }
    );
  };

  return (
    <Card className="flex flex-col gap-y-1  p-4">
      <h1 className="text-lg font-semibold text-primary-foreground">
        Organization Slug
      </h1>
      <p className="text-sm text-muted-foreground">
        {`This is your organization's URL namespace on WunderGraph Cosmo. Within it, your members can inspect their projects, check out any recent activity, or configure settings to their liking.`}
      </p>

      <form onSubmit={handleSubmit(handleChangeOrgSlug)} className="mt-4">
        <div className="flex flex-col gap-y-2">
          <Input
            type="text"
            defaultValue={user?.currentOrganization.slug}
            {...register("organizationSlug")}
          />
          {errors.organizationSlug && (
            <span className="px-2 text-xs text-destructive">
              {errors.organizationSlug.message}
            </span>
          )}
          <div className="mt-2 flex justify-end">
            <Button
              variant="default"
              isLoading={isLoading}
              type="submit"
              disabled={
                !isValid || !user?.currentOrganization.roles.includes("admin")
              }
            >
              Save
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
};

const LeaveOrganization = () => {
  const [user] = useContext(UserContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const regex = new RegExp(`^${user?.currentOrganization.name}$`);
  const schema = z.object({
    organizationName: z.string().regex(regex, {
      message: "Please enter the organization name as requested.",
    }),
  });

  type LeaveOrgInput = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useZodForm<LeaveOrgInput>({
    schema,
    mode: "onChange",
  });

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
              description: "Left the organization succesfully.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
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
    <Card className="flex flex-col gap-y-1 border border-destructive p-4">
      <h1 className="text-lg font-semibold text-primary-foreground">
        Leave Organization
      </h1>
      <p className="text-sm text-muted-foreground">
        Revoke your access to this organization. Any contributions you have
        added to the organization will persist.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="mt-2 flex justify-end" asChild>
          <div>
            <Button type="submit" variant="destructive">
              Leave organization
            </Button>
          </div>
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
          <form onSubmit={handleSubmit(handleLeaveOrg)} className="mt-2">
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
                  Leave
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

const DeleteOrganization = () => {
  const [user] = useContext(UserContext);
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
    <Card className="flex flex-col gap-y-1 border border-destructive p-4">
      <h1 className="text-lg font-semibold text-primary-foreground">
        Delete Organization
      </h1>
      <p className="text-sm text-muted-foreground">
        The organization will be permanently deleted. This action is
        irreversible and can not be undone.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          disabled={!user?.currentOrganization.roles.includes("admin")}
          className={cn(
            {
              "cursor-not-allowed":
                !user?.currentOrganization.roles.includes("admin"),
            },
            "mt-2 flex justify-end"
          )}
          asChild
        >
          <div>
            <Button
              type="submit"
              variant="destructive"
              disabled={!user?.currentOrganization.roles.includes("admin")}
            >
              Delete organization
            </Button>
          </div>
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
    </Card>
  );
};

const SettingsDashboardPage: NextPageWithLayout = () => {
  const [user] = useContext(UserContext);

  return (
    <div className="mt-4 flex flex-col gap-y-4">
      <OrganizationName />
      <OrganizationSlug />
      {!user?.currentOrganization.isPersonal && (
        <>
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
