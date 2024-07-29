import { docsBaseURL } from "@/lib/constants";
import { useQuery } from "@connectrpc/connect-query";
import { getNamespaces } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useEffect, useState } from "react";
import { useApplyParams } from "../analytics/use-apply-params";
import { UserContext } from "../app-provider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export const NamespaceSelector = ({
  shouldRedirect,
}: {
  shouldRedirect?: boolean;
}) => {
  const user = useContext(UserContext);
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespaceParam = router.query.namespace as string;

  const [namespaces, setNamespaces] = useState(["default"]);
  const [namespace, setNamespace] = useState(namespaceParam || "default");

  const { data, refetch } = useQuery(getNamespaces);

  const applyParams = useApplyParams();

  useEffect(() => {
    if (!data || data.namespaces.length === 0) return;

    if (!data.namespaces.some((ns) => ns.name === namespace)) {
      setNamespace("default");
      applyParams({
        namespace: "default",
      });
    }

    setNamespaces(data.namespaces.map((ns) => ns.name));
  }, [applyParams, data, namespace, setNamespaces]);

  useEffect(() => {
    if (!namespaceParam && !!namespace) {
      applyParams({
        namespace,
      });
    }
  }, [namespace, namespaceParam, applyParams]);

  return (
    <Select
      value={namespace}
      onValueChange={(namespace) => {
        if (shouldRedirect) {
          router.push(
            `/${organizationSlug}/feature-flags?namespace=${namespace}`,
          );
        } else {
          applyParams({ namespace });
        }
        setNamespace(namespace);
      }}
    >
      <SelectTrigger
        className="flex h-8 max-w-[180px] gap-x-2 border-0 bg-transparent pl-3 pr-1 text-muted-foreground shadow-none data-[state=open]:bg-accent data-[state=open]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:ring-0 lg:max-w-xs"
        value={namespace}
      >
        <SelectValue asChild aria-label={namespace}>
          <p className="mr-2 w-full truncate text-start">{namespace}</p>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectGroup>
          <SelectLabel>Namespaces</SelectLabel>
          <p className="max-w-xs px-2 text-sm text-muted-foreground">
            Easily switch between namespaces. Learn more{" "}
            <Link
              target="_blank"
              className="text-primary"
              href={`${docsBaseURL}/cli/essentials#namespaces`}
            >
              here.
            </Link>{" "}
          </p>
          <SelectSeparator />
          {namespaces.map((ns) => {
            return (
              <SelectItem key={ns} value={ns}>
                {ns}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
