import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  UpdateOrganizationGroupRequest_GroupRule,
  GetUserAccessibleResourcesResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { roles } from "@/lib/constants";
import { useMemo, useState } from "react";
import { PopoverContentWithScrollableContent } from "../popover-content-with-scrollable-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, CheckIcon, MinusIcon } from "@heroicons/react/24/outline";
import { useGroupResources, GroupResource, GroupResourceItem } from "./use-group-resources";
import { RiLoader5Fill } from "react-icons/ri";

export function GroupResourceSelector({ rule, disabled, activeRole, accessibleResources, onRuleUpdated }: {
  rule: UpdateOrganizationGroupRequest_GroupRule,
  disabled: boolean;
  activeRole: (typeof roles[number]) | undefined;
  accessibleResources: GetUserAccessibleResourcesResponse | undefined;
  onRuleUpdated(rule: UpdateOrganizationGroupRequest_GroupRule): void;
}) {
  const availableResources = useGroupResources({ rule, activeRole, accessibleResources });

  const toggleResources = (resources: string[], isNamespaceResource: boolean) => {
    const newRule = rule.clone();
    const setOfSelectedResources = new Set(isNamespaceResource ? rule.namespaces : rule.resources);
    for (const res of Array.from(new Set(resources))) {
      if (setOfSelectedResources.has(res)) {
        setOfSelectedResources.delete(res);
      } else {
        setOfSelectedResources.add(res);
      }
    }

    if (isNamespaceResource) {
      newRule.namespaces = Array.from(setOfSelectedResources);
    } else {
      newRule.resources = Array.from(setOfSelectedResources);
    }

    onRuleUpdated(newRule);
  };

  const selectedResources = rule.namespaces.length + rule.resources.length;
  return accessibleResources ? (
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
      <PopoverContentWithScrollableContent className="p-1 text-sm w-[400px]">
        <div className="max-h-[32rem] overflow-auto">
          {availableResources.length > 0
            ? availableResources.map((res, index) => (
              <GroupSelectorItem
                key={`resource-${index}`}
                depth={0}
                toggleResources={toggleResources}
                {...res}
              />
            ))
            : (
              <div className="p-2 text-center text-muted-foreground">No resources available</div>
            )}
        </div>
      </PopoverContentWithScrollableContent>
    </Popover>
  ) : (
    <div className="flex justify-start items-center grow truncate h-9 text-sm gap-x-2">
      <RiLoader5Fill className="size-4 animate-spin" />
      <span>Loading resources...</span>
    </div>
  );
}

function flatten(children: GroupResourceItem[]): GroupResourceItem[] {
  const result: GroupResourceItem[] = [];
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

function GroupSelectorItem({ type, label, children, depth, toggleResources, ...rest }: GroupResource & {
  depth: number;
  toggleResources(res: string[], isNamespaceResource: boolean) : void;
}) {
  const [expanded, setExpanded] = useState(false);
  const flattenChildren = useMemo(() => flatten(children ?? []), [children]);
  if (children && children.length === 0) {
    return null;
  }

  if (type === "segment") {
    return (
      <>
        <div className="text-xs text-muted-foreground p-1.5 uppercase select-none">
          {label}
        </div>
        {children?.map((child) => (
          <GroupSelectorItem
            key={child.value}
            depth={depth}
            toggleResources={toggleResources}
            {...child}
          />
        ))}
      </>
    );
  }

  const { value, isNamespaceResource, disabled, selected } = rest as GroupResourceItem;
  const hasChildren = children && children.length > 0;
  const isExpanded = expanded;
  const hasSelectedSomeChildren = hasChildren && flattenChildren.some((c) => c.selected);
  const hasSelectedEveryChildren = hasChildren && flattenChildren.every((c) => c.selected);

  return (
    <>
      <div
        className={cn(
          "flex justify-start items-center gap-x-1.5 px-2.5 py-1.5 hover:bg-accent rounded select-none w-full group/item",
          disabled && "opacity-50 cursor-not-allowed hover:bg-transparent"
        )}
        role="button"
        onClick={() => {
          if (disabled) {
            return;
          }

          if (hasChildren) {
            setExpanded(!expanded);
          } else {
            toggleResources([value], isNamespaceResource);
          }
        }}
      >
        {hasChildren ? (
          <ChevronRightIcon
            className={cn("size-3 transition-all duration-200 shrink-0", isExpanded && "rotate-90")}
          />
        ) : depth > 0 && <span className="w-4 shrink-0" /> }

        <span
          className={cn("group/check shrink-0", disabled && "pointer-events-none")}
          role="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (disabled) {
              return;
            }

            if (hasChildren) {
              if (hasSelectedEveryChildren) {
                toggleResources(flattenChildren.map((res) => res.value), isNamespaceResource);
              } else {
                toggleResources(
                  flattenChildren.filter((res) => !res.selected).map((res) => res.value),
                  isNamespaceResource
                );
              }
            } else {
              toggleResources([value], isNamespaceResource);
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
      {children && children.length > 0 && isExpanded && (
        <div className="pl-[18px]">
          {children.map((child) => (
            <GroupSelectorItem key={child.value} {...child} depth={depth + 1} toggleResources={toggleResources} />
          ))}
        </div>)}
    </>
  );
}
