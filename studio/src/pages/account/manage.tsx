import { UserContext } from "@/components/app-provider";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useZodForm } from "@/hooks/use-form";
import { NextPageWithLayout } from "@/lib/page";
import { useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { deleteUser } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { z } from "zod";

const ManageAccountPage: NextPageWithLayout = () => {
  const user = useContext(UserContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const schema = z.object({
    email: z.string().regex(new RegExp(`^${user?.email}$`), {
      message: "Please enter your email as requested.",
    }),
    confirmation: z.string().regex(new RegExp(`^DELETE MY ACCOUNT$`), {
      message: "Please enter the confirmation correctly",
    }),
  });

  type DeleteAccountInput = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useZodForm<DeleteAccountInput>({
    schema,
    mode: "onChange",
  });

  const { mutate, isPending } = useMutation(deleteUser);

  const { toast } = useToast();

  const handleDeleteUser = () => {
    mutate(
      {},
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({
              description: "Deleted successfully.",
              duration: 3000,
            });
            router.replace("/");
          } else if (d.response?.details) {
            toast({ description: d.response.details });
          }
        },
        onError: () => {
          toast({
            description: "Could not delete the account. Please try again.",
            duration: 3000,
          });
        },
      },
    );
    setOpen(false);
  };

  return (
    <Card className="border-destructive">
      <CardHeader className="gap-y-6 md:flex-row">
        <div className="space-y-1.5">
          <CardTitle>Delete Account</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Your account will be permanently deleted. This action is
            irreversible! <br /> You will lose memberships to all your
            organizations and any API keys created by you will be deleted.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="destructive"
              className="w-full md:ml-auto md:w-max"
            >
              Delete account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Are you sure you want to delete your account?
              </DialogTitle>
              <span className="text-sm text-muted-foreground">
                This action cannot be undone.
              </span>
            </DialogHeader>
            <form onSubmit={handleSubmit(handleDeleteUser)} className="mt-2">
              <div className="flex flex-col gap-y-3">
                <span className="text-sm">
                  Enter your email <strong>{user?.email}</strong>.
                </span>
                <Input type="text" {...register("email")} autoFocus={true} />
                {errors.email && (
                  <span className="px-2 text-xs text-destructive">
                    {errors.email.message}
                  </span>
                )}
                <span className="mt-2 text-sm">
                  Enter <strong>DELETE MY ACCOUNT</strong> to confirm.
                </span>
                <Input type="text" {...register("confirmation")} />
                {errors.confirmation && (
                  <span className="px-2 text-xs text-destructive">
                    {errors.confirmation.message}
                  </span>
                )}
                <div className="mt-2 flex justify-end gap-x-4">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    isLoading={isPending}
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
      </CardHeader>
    </Card>
  );
};

ManageAccountPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Manage Account",
    "Manage your account settings and preferences.",
  );
};

export default ManageAccountPage;
