import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useState } from "react";
import { useToast } from "../ui/use-toast";
import { configureCacheWarmer } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useMutation } from "@connectrpc/connect-query";
import { Button } from "../ui/button";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";

export const CacheWarmerConfig = ({
  currentOperationsCount,
  cacheWarmerEnabled,
  refetch,
}: {
  currentOperationsCount: number;
  cacheWarmerEnabled: boolean;
  refetch: () => void;
}) => {
  const { namespace: { name: namespace } } = useWorkspace();
  const { mutate: configureCacheWarmerConfig, isPending } =
    useMutation(configureCacheWarmer);
  const [maxOperationsCount, setMaxOperationsCount] = useState(
    currentOperationsCount.toString(),
  );
  const { toast } = useToast();
  const checkUserAccess = useCheckUserAccess();

  const operationsCountOptions = [
    { value: "100", label: "100" },
    { value: "200", label: "200" },
    { value: "300", label: "300" },
    { value: "400", label: "400" },
    { value: "500", label: "500" },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <div className="flex flex-col gap-y-2">
            <CardTitle>Cache Warmer Configuration</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              {cacheWarmerEnabled
                ? "Configure the cache warmer configuration of this namespace."
                : "Enable cache warmer to set the configuration."}
            </CardDescription>
          </div>
          <Button
            type="submit"
            variant="default"
            isLoading={isPending}
            disabled={
              !cacheWarmerEnabled ||
              !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
            }
            onClick={() => {
              configureCacheWarmerConfig(
                {
                  namespace,
                  enableCacheWarmer: cacheWarmerEnabled,
                  maxOperationsCount: parseInt(maxOperationsCount),
                },
                {
                  onSuccess: (d) => {
                    if (d.response?.code === EnumStatusCode.OK) {
                      toast({
                        description: "Cache warmer config set successfully.",
                        duration: 3000,
                      });
                    } else if (d.response?.details) {
                      toast({
                        description: d.response.details,
                        duration: 3000,
                      });
                    }
                    refetch();
                  },
                  onError: (_) => {
                    toast({
                      description:
                        "Could not set the cache warmer config. Please try again.",
                      duration: 3000,
                    });
                  },
                },
              );
            }}
          >
            Apply
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex w-full flex-col gap-y-3 divide-y divide-solid divide-secondary">
          <div className="flex w-full flex-col justify-between gap-y-4 pt-3 md:flex-row md:items-center">
            <div className="flex flex-col gap-y-1">
              <label
                htmlFor="OperationsCount"
                className="break-all text-sm font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Operations Count
              </label>
              <span className="text-sm text-muted-foreground">
                Maximum number of operations used for warming the cache.
              </span>
            </div>
            <div className="ml-8 flex gap-x-3 md:ml-0">
              <Select
                value={maxOperationsCount}
                onValueChange={(value) => {
                  setMaxOperationsCount(value);
                }}
                disabled={
                  !cacheWarmerEnabled ||
                  !checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] })
                }
              >
                <SelectTrigger className="h-8 w-36">
                  <SelectValue placeholder={maxOperationsCount} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {operationsCountOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
