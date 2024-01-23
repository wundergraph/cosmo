import { useLocalStorage } from "@/hooks/use-local-storage";
import { useQuery } from "@tanstack/react-query";
import { getNamespaces } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useApplyParams } from "../analytics/use-apply-params";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Toolbar } from "../ui/toolbar";

export const NamespaceSelector = () => {
  const router = useRouter();
  const namespaceParam = router.query.namespace as string;

  const [namespaces, setNamespaces] = useState(["default"]);

  const [namespace, setNamespace] = useLocalStorage(
    "namespace",
    namespaceParam || "default",
  );

  const { data } = useQuery(getNamespaces.useQuery());
  useEffect(() => {
    if (!data || data.namespaces.length === 0) return;
    setNamespaces(data.namespaces.map((ns) => ns.name));
  }, [data]);

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
          <SelectValue aria-label={namespace}>{namespace}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Namespace</SelectLabel>
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
