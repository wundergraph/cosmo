import { useMutation } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  updateNamespaceChecksConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetNamespaceChecksConfigurationResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useToast } from "../ui/use-toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { useState, useEffect } from "react";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";

const TimeframeDropdown = ({
  onChange,
  value,
  limit,
  disabled,
}: {
  onChange: (value: number) => void;
  value: string;
  limit: number;
  disabled: boolean;
}) => {
  const selectOptions = [
    { label: "1 day", value: 1 },
    { label: "3 days", value: 3 },
    { label: "7 days", value: 7 },
    { label: "10 days", value: 10 },
    { label: "14 days", value: 14 },
    { label: "30 days", value: 30 },
    { label: "45 days", value: 45 },
    { label: "60 days", value: 60 },
    { label: "90 days", value: 90 },
  ];

  return (
    <Select
      value={value}
      onValueChange={(value) => {
        onChange(Number(value));
      }}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-36">
        <SelectValue placeholder={value} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {selectOptions.filter((option) => option.value <= limit).map((option) => (
            <SelectItem key={`${option.value}`} value={`${option.value}`}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

export const ChecksConfig = ({
  namespace,
  data,
}: {
  namespace: string;
  data: GetNamespaceChecksConfigurationResponse;
}) => {
  const checkUserAccess = useCheckUserAccess();
  const [timeframeInDays, setTimeframeInDays] = useState(data.timeframeInDays);
  useEffect(() => setTimeframeInDays(data.timeframeInDays), [data.timeframeInDays]);

  const { mutate, isPending } = useMutation(updateNamespaceChecksConfig);

  const { toast } = useToast();

  const isAdminOrDeveloper = checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] });

  return (
    <div className="space-y-6 rounded-lg border p-6">
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-col gap-y-1">
          <h3 className="font-semibold tracking-tight">Schema Checks</h3>
          <p className="text-sm text-muted-foreground">
            Configure the options used for checks of subgraphs of this namespace.
          </p>
        </div>

        <Button
          isLoading={isPending}
          disabled={!isAdminOrDeveloper}
          onClick={() => {
            mutate(
              { namespace, timeframeInDays, },
              {
                onSuccess: (d) => {
                  if (d.response?.code === EnumStatusCode.OK) {
                    toast({
                      description: "Schema checks updated successfully.",
                      duration: 3000,
                    });
                  } else if (d.response?.details) {
                    toast({ description: d.response.details, duration: 3000 });
                  }
                },
                onError: () => {
                  toast({
                    description:
                      "Could not update the schema checks. Please try again.",
                    duration: 3000
                  });
                },
              }
            );
          }}
        >
          Apply
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div
            className="flex w-full flex-col justify-between gap-y-4 md:flex-row md:items-center"
          >
            <div className="flex items-start gap-x-4">
              <div className="flex flex-col gap-y-1">
                <span
                  className="break-all text-sm font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Check days to consider
                </span>
                <span className="text-sm text-muted-foreground">
                  This is the number of days to consider when performing a subgraph check.
                </span>
              </div>
            </div>

            <div className="ml-8 md:ml-0">
              <TimeframeDropdown
                value={`${timeframeInDays}`}
                limit={data.timeframeLimitInDays}
                onChange={setTimeframeInDays}
                disabled={isPending || !isAdminOrDeveloper}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
