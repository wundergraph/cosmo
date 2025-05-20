import {
  UpdateOrganizationGroupRequest_GroupRule,
  GetUserAccessibleResourcesResponse,
  GetUserAccessibleResourcesResponse_Namespace,
  GetUserAccessibleResourcesResponse_FederatedGraph,
  GetUserAccessibleResourcesResponse_SubGraph,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { roles } from "@/lib/constants";
import { useMemo } from "react";

export interface GroupResourceSection {
  type: "section";
  label: string;
  children: GroupResourceItem[];
}

export interface GroupResourceItem {
  type: "item";
  label: string;
  value: string;
  isNamespaceResource: boolean;
  selected: boolean;
  disabled: boolean;
  children?: GroupResourceItem[];
}

export type GroupResource = GroupResourceSection | GroupResourceItem;

export function useGroupResources({ rule, activeRole, accessibleResources }: {
  rule: UpdateOrganizationGroupRequest_GroupRule,
  activeRole: (typeof roles[number]) | undefined,
  accessibleResources: GetUserAccessibleResourcesResponse | undefined,
}): readonly GroupResource[] {
  return useMemo<readonly GroupResource[]>(() => {
    const result: GroupResource[] = [];
    if (!accessibleResources) {
      return result;
    }

    result.push({
      type: "section",
      label: "Namespaces",
      children: accessibleResources.namespaces.map((ns) => mapNamespace(rule, ns))
    });

    if (activeRole?.category === "graph") {
      const fedGraphsByNamespace = Object.groupBy(
        accessibleResources.federatedGraphs,
        (graph) => graph.namespace
      );

      result.push({
        type: "section",
        label: "Federated Graphs",
        children: Object.entries(fedGraphsByNamespace)
          .map(([namespace, graphs]) => ({
            ...mapNamespace(rule, accessibleResources.namespaces.find((ns) => ns.name === namespace)!),
            isNamespaceResource: false,
            selected: false,
            disabled: rule.namespaces.length > 0,
            children: graphs?.map((graph) => mapGraph(rule, graph)),
          } satisfies GroupResourceItem))
          .filter((d) => d.children && d.children.length > 0),
      });
    } else if (activeRole?.category === "subgraph") {
      const subGraphsByNamespace = Object.groupBy(
        accessibleResources.subgraphs,
        (graph) => graph.namespace
      );

      result.push({
        type: "section",
        label: "Subgraphs",
        children: Object.entries(subGraphsByNamespace)
          .map(([namespace, graphs]) => {
            const subGraphsByFedGraph = Object.groupBy(
              graphs ?? [],
              (graph) => graph.federatedGraphId
            );

            return {
              ...mapNamespace(rule, accessibleResources.namespaces.find((ns) => ns.name === namespace)!),
              isNamespaceResource: false,
              selected: false,
              disabled: rule.namespaces.length > 0,
              children: Object.entries(subGraphsByFedGraph)
                .map(([fedGraph, subgraphs]) => ({
                  ...mapGraph(rule, accessibleResources.federatedGraphs.find((graph) => graph.targetId === fedGraph)!),
                  children: (subgraphs ?? []).map((graph) => mapGraph(rule, graph)),
                }) satisfies GroupResourceItem)
                .filter((d) => d.children && d.children.length > 0),
            } satisfies GroupResourceItem;
          })
          .filter((d) => d.children && d.children.length > 0),
      });
    }

    return result;
  }, [rule, activeRole, accessibleResources]);
}

function mapNamespace(
  rule: UpdateOrganizationGroupRequest_GroupRule,
  namespace: GetUserAccessibleResourcesResponse_Namespace,
): GroupResourceItem {
  return {
    type: "item",
    label: namespace.name,
    value: namespace.id,
    isNamespaceResource: true,
    selected: rule.namespaces.includes(namespace.id),
    disabled: rule.resources.length > 0,
  };
}

function mapGraph(
  rule: UpdateOrganizationGroupRequest_GroupRule,
  graph: GetUserAccessibleResourcesResponse_FederatedGraph | GetUserAccessibleResourcesResponse_SubGraph
): GroupResourceItem {
  return {
    type: "item",
    label: graph.name,
    value: graph.targetId,
    isNamespaceResource: false,
    selected: rule.resources.includes(graph.targetId),
    disabled: rule.namespaces.length > 0,
  };
}