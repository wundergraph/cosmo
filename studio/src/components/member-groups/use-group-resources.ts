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
  type: "segment";
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
      type: "segment",
      label: "Namespaces",
      children: getNamespaces(rule, accessibleResources),
    });

    if (activeRole?.category === "graph") {
      result.push({
        type: "segment",
        label: "Federated Graphs",
        children: getFederatedGraphs(rule, accessibleResources),
      });
    } else if (activeRole?.category === "subgraph") {
      result.push({
        type: "segment",
        label: "Subgraphs",
        children: getSubGraphs(rule, accessibleResources),
      });
    }

    return result;
  }, [rule, activeRole, accessibleResources]);
}

function mapNamespace(
  rule: UpdateOrganizationGroupRequest_GroupRule,
  namespace: GetUserAccessibleResourcesResponse_Namespace,
): Omit<GroupResourceItem, 'disabled'> {
  return {
    type: "item",
    label: namespace.name,
    value: namespace.id,
    isNamespaceResource: true,
    selected: rule.namespaces.includes(namespace.id),
  };
}

function mapGraph(
  rule: UpdateOrganizationGroupRequest_GroupRule,
  graph: GetUserAccessibleResourcesResponse_FederatedGraph | GetUserAccessibleResourcesResponse_SubGraph
): Omit<GroupResourceItem, 'disabled'> {
  return {
    type: "item",
    label: graph.name,
    value: graph.targetId,
    isNamespaceResource: false,
    selected: rule.resources.includes(graph.targetId),
  };
}

function getNamespaces(
  rule: UpdateOrganizationGroupRequest_GroupRule,
  accessibleResources: GetUserAccessibleResourcesResponse
): GroupResourceItem[] {
  return accessibleResources.namespaces.map((ns) => {
    const namespaceResources = [
      ...accessibleResources.federatedGraphs
        .filter((graph) => graph.namespace === ns.name)
        .map((graph) => graph.targetId),
      ...accessibleResources.subgraphs
        .filter((graph) => graph.namespace === ns.name)
        .map((graph) => graph.targetId),
    ];

    return {
      ...mapNamespace(rule, ns),
      disabled: rule.resources.some((res) => namespaceResources.includes(res)),
    } satisfies GroupResourceItem;
  });
}

function getFederatedGraphs(
  rule: UpdateOrganizationGroupRequest_GroupRule,
  accessibleResources: GetUserAccessibleResourcesResponse
): GroupResourceItem[] {
  const fedGraphsByNamespace = Object.groupBy(
    accessibleResources.federatedGraphs,
    (graph) => graph.namespace
  );

  return Object.entries(fedGraphsByNamespace)
    .map(([namespace, graphs]) => {
      const ns = accessibleResources.namespaces.find((ns) => ns.name === namespace)!;
      const isNamespaceSelected = rule.namespaces.includes(ns.id);

      return {
        ...mapNamespace(rule, ns),
        isNamespaceResource: false,
        selected: false,
        disabled: isNamespaceSelected,
        children: graphs?.map((graph) => ({
          ...mapGraph(rule, graph),
          disabled: isNamespaceSelected
        } satisfies GroupResourceItem)),
      } satisfies GroupResourceItem;
    })
    .filter((d) => d.children && d.children.length > 0);
}

function getSubGraphs(
  rule: UpdateOrganizationGroupRequest_GroupRule,
  accessibleResources: GetUserAccessibleResourcesResponse
): GroupResourceItem[] {
  const subGraphsByNamespace = Object.groupBy(
    accessibleResources.subgraphs,
    (graph) => graph.namespace
  );

  return Object.entries(subGraphsByNamespace)
    .map(([namespace, graphs]) => {
      const subGraphsByFedGraph = Object.groupBy(
        graphs ?? [],
        (graph) => graph.federatedGraphId
      );

      const ns = accessibleResources.namespaces.find((ns) => ns.name === namespace)!;
      const isNamespaceSelected = rule.namespaces.includes(ns.id);

      return {
        ...mapNamespace(rule, ns),
        isNamespaceResource: false,
        selected: false,
        disabled: isNamespaceSelected,
        children: Object.entries(subGraphsByFedGraph)
          .map(([fedGraph, subgraphs]) => ({
            ...mapGraph(rule, accessibleResources.federatedGraphs.find((graph) => graph.targetId === fedGraph)!),
            selected: false,
            disabled: isNamespaceSelected,
            children: (subgraphs ?? []).map((graph) => ({
              ...mapGraph(rule, graph),
              disabled: isNamespaceSelected,
            } satisfies GroupResourceItem)),
          }) satisfies GroupResourceItem)
          .filter((d) => d.children && d.children.length > 0),
      } satisfies GroupResourceItem;
    })
    .filter((d) => d.children && d.children.length > 0)
}