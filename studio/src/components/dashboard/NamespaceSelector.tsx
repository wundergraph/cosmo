import { useLocalStorage } from "@/hooks/use-local-storage";
import { docsBaseURL } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { getNamespaces } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useApplyParams } from "../analytics/use-apply-params";
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
import { Toolbar } from "../ui/toolbar";

export const NamespaceSelector = () => {
  const router = useRouter();
  const namespaceParam = router.query.namespace as string;

  const [namespaces, setNamespaces] = useState(["default"]);

  // Retrieve the stored namespace from local storage
  const [namespace, setNamespace] = useLocalStorage(
    "namespace",
    namespaceParam || "default",
  );

  const { data } = useQuery(getNamespaces.useQuery());

  useEffect(() => {
    if (!data || data.namespaces.length === 0) return;

    if (!data.namespaces.some((ns) => ns.name === namespace)) {
      setNamespace("default");
    }

    setNamespaces(data.namespaces.map((ns) => ns.name));
  }, [data, namespace, setNamespace]);

  const applyParams = useApplyParams();

  if (!namespaceParam && !!namespace) {
    applyParams({
      namespace,
    });
  }

  return (
    <Toolbar className="flex-nowrap py-0 lg:w-auto">
      <Select
        value={namespace}
        onValueChange={(namespace) => {
          applyParams({ namespace });
          setNamespace(namespace);
        }}
      >
        <SelectTrigger className="lg:w-64" value={namespace}>
          <SelectValue aria-label={namespace}>
            Namespace: {namespace}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
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
    </Toolbar>
  );
};
