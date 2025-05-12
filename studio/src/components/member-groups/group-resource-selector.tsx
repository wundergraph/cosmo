import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  UpdateOrganizationGroupRequest_GroupRule,
  GetUserAccessibleResourcesResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { roles } from "@/lib/constants";
import { useMemo, useState } from "react";
import { HackyPopoverContent } from "./hacky-popover-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, CheckIcon, MinusIcon } from "@heroicons/react/24/outline";

interface GroupResource {
  label: string;
  value: string;
  selected: boolean;
  children?: GroupResource[];
}

export function GroupResourceSelector({ rule, disabled, activeRole, accessibleResources, onRuleUpdated }: {
  rule: UpdateOrganizationGroupRequest_GroupRule,
  disabled: boolean;
  activeRole: (typeof roles[number]) | undefined;
  accessibleResources: GetUserAccessibleResourcesResponse | undefined;
  onRuleUpdated(rule: UpdateOrganizationGroupRequest_GroupRule): void;
}) {
  const availableResources = useMemo<GroupResource[]>(() => {
    if (!accessibleResources) {
      return [];
    }

    switch (activeRole?.category) {
      case "namespace": {
        return accessibleResources.federatedGraphs
          .map((g) => g.namespace)
          .filter((value, index, array) => array.indexOf(value) === index)
          .map((ns) => ({
            label: ns,
            value: ns,
            selected: rule.namespaces.includes(ns),
          }));
      }
      case "graph": {
        return Object.entries(Object.groupBy(accessibleResources.federatedGraphs, (g) => g.namespace))
          .map(([ns, graphs]) => ({
            label: ns,
            value: ns,
            selected: false,
            children: graphs!.map((g) => ({
              label: g.name,
              value: g.targetId,
              selected: rule.resources.includes(g.targetId),
            })),
          }))
          .filter((d) => d.children.length > 0);
      }
      case "subgraph": {
        return Object.entries(Object.groupBy(accessibleResources.subgraphs, (g) => g.namespace))
          .map(([ns, graphs]) => ({
            label: ns,
            value: ns,
            selected: false,
            children: Object
              .entries(Object.groupBy(graphs!, (g) => g.federatedGraphId))
              .map(([graph, subgraphs]) => ({
                federatedGraph: accessibleResources.federatedGraphs.find((g) => g.targetId === graph)!,
                subgraphs: subgraphs!,
              }))
              .filter((m) => Boolean(m.federatedGraph))
              .map((m) => ({
                label: m.federatedGraph.name,
                value: m.federatedGraph.targetId,
                selected: false,
                children: m.subgraphs.map((g) => ({
                  label: g.name,
                  value: g.targetId,
                  selected: rule.resources.includes(g.targetId),
                })),
              }))
              .filter((d) => d.children.length > 0),
          }))
          .filter((d) => d.children.length > 0);
      }
      default:
        return [];
    }
  }, [activeRole, accessibleResources, rule]);

  const toggleResources = (resources: string[]) => {
    const newRule = rule.clone();
    const isNamespaceRule = activeRole?.category === 'namespace';
    const setOfSelectedResources = new Set(isNamespaceRule ? rule.namespaces : rule.resources);
    for (const res of resources) {
      if (setOfSelectedResources.has(res)) {
        setOfSelectedResources.delete(res);
      } else {
        setOfSelectedResources.add(res);
      }
    }

    if (isNamespaceRule) {
      newRule.namespaces = Array.from(setOfSelectedResources);
    } else {
      newRule.resources = Array.from(setOfSelectedResources);
    }

    onRuleUpdated(newRule);
  };

  const selectedResources = rule.namespaces.length + rule.resources.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="link"
          className="px-0 justify-start grow truncate"
          disabled={disabled}
        >
          <span className="truncate">
            {selectedResources === 0
              ? "Grants access to all resources."
              : `${selectedResources} resource(s) selected`}
          </span>
        </Button>
      </PopoverTrigger>
      <HackyPopoverContent className="p-1 text-sm w-[400px]">
        <div className="max-h-72 overflow-auto">
          {availableResources.length > 0
            ? availableResources.map((res) => (
              <GroupSelectorItem
                key={res.value}
                depth={0}
                toggleResources={toggleResources}
                {...res}
              />
            ))
            : (
              <div className="p-2 text-center text-muted-foreground">No resources available</div>
            )}
        </div>
      </HackyPopoverContent>
    </Popover>
  );
}

function flatten(children: GroupResource[]): GroupResource[] {
  const result: GroupResource[] = [];
  for (const child of children) {
    if (!child.children) {
      result.push(child);
      continue;
    } else if (!child.children || child.children.length === 0) {
      continue;
    }

    result.push(...flatten(child.children));
  }

  return result;
}

function GroupSelectorItem({ label, value, selected, children, depth, toggleResources }: GroupResource & {
  depth: number;
  toggleResources(res: string[]) : void;
}) {
  const [expanded, setExpanded] = useState(false);
  const flattenChildren = useMemo(() => flatten(children ?? []), [children]);
  if (children && children.length === 0) {
    return null;
  }

  const hasChildren = children && children.length > 0;
  const hasSelectedSomeChildren = hasChildren && flattenChildren.some((c) => c.selected);
  const hasSelectedEveryChildren = hasChildren && flattenChildren.every((c) => c.selected);
  return (
    <>
      <div
        className="flex justify-start items-center gap-x-1.5 px-2.5 py-1.5 hover:bg-accent rounded select-none w-full group/item"
        role="button"
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          } else {
            toggleResources([value]);
          }
        }}
      >
        {hasChildren ? (
          <ChevronRightIcon
            className={cn("size-3 transition-all duration-200 shrink-0", expanded && "rotate-90")}
          />
        ) : depth > 0 && <span className="w-4 shrink-0" /> }

        <span
          className="group/check shrink-0"
          role="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (hasChildren) {
              const flattenChildren = flatten(children);
              if (hasSelectedEveryChildren) {
                toggleResources(flattenChildren.map((res) => res.value));
              } else {
                toggleResources(flattenChildren.filter((res) => !res.selected).map((res) => res.value));
              }
            } else {
              toggleResources([value]);
            }
          }}
        >
          <span
            className={cn(
              "flex justify-center items-center size-5 border border-border rounded transition-all duration-200",
              selected || hasSelectedSomeChildren
                ? "bg-primary"
                : "bg-popover hover:bg-accent group-hover/item:bg-popover group-hover/check:bg-gray-500/30"
            )}
          >
            {(selected || hasSelectedEveryChildren) ? (
              <CheckIcon className="size-3" />
            ) : hasSelectedSomeChildren ? (
              <MinusIcon className="size-3" />
            ) : null}
          </span>
        </span>

        <span className="truncate grow">
          {label}
        </span>
      </div>
      {children && children.length > 0 && expanded && (
        <div className="pl-[18px]">
          {children.map((child) => (
            <GroupSelectorItem key={child.value} {...child} depth={depth + 1} toggleResources={toggleResources} />
          ))}
        </div>)}
    </>
  );
}
