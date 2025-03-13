import { useUser } from "@/hooks/use-user";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  updateNamespaceChecksConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetNamespaceChecksConfigurationResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Input } from "@/components/ui/input";
import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "../ui/use-toast";
import { z } from "zod";
import {useMemo} from "react";

export const ChecksConfig = ({
  namespace,
  data,
}: {
  namespace: string;
  data: GetNamespaceChecksConfigurationResponse;
}) => {
  const user = useUser();

  const schema = z.object({
    timeframeInDays: z.coerce.number().min(1).max(data.timeframeLimitInDays),
  });

  type ChecksConfigurationInput = z.infer<typeof schema>;

  const { mutate, isPending } = useMutation(updateNamespaceChecksConfig);

  const { toast } = useToast();

  const form = useZodForm<ChecksConfigurationInput>({
    schema,
    mode: "onChange",
    values: useMemo(() => ({ timeframeInDays: data.timeframeInDays }), [data]),
  });

  const onSubmit: SubmitHandler<ChecksConfigurationInput> = (data) => {
    mutate(
      {
        namespace,
        timeframeInDays: data.timeframeInDays,
      },
      {
        onSuccess: (d) => {
          if (d.response?.code === EnumStatusCode.OK) {
            toast({
              description: "Checks configuration updated successfully.",
              duration: 3000,
            });
          } else if (d.response?.details) {
            toast({ description: d.response.details, duration: 3000 });
          }
        },
        onError: () => {
          toast({
            description:
              "Could not update the checks configuration. Please try again.",
            duration: 3000
          });
        },
      }
    )
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-y-4"
      >
        <FormField
          control={form.control}
          name="timeframeInDays"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Days to consider</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={data.timeframeLimitInDays}
                  step={1}
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                <p>This is the number of days to consider when performing a subgraph check.</p>
                <p>Maximum value is <strong>{data.timeframeLimitInDays}</strong></p>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          className="ml-auto"
          isLoading={isPending}
          type="submit"
          disabled={
            !form.formState.isValid ||
            (
              !user?.currentOrganization.roles.includes("admin") &&
              !user?.currentOrganization.roles.includes("developer")
            )
          }
        >
          Save
        </Button>
      </form>
    </Form>
  );
};
