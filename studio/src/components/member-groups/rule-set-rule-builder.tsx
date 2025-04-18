import type {
  OrganizationRuleSetRule,
  GetUserAccessibleResourcesResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { roles } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TrashIcon } from "@heroicons/react/24/outline";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { CheckIcon } from "@radix-ui/react-icons";
import { Separator } from "@/components/ui/separator";
import useWindowSize from "@/hooks/use-window-size";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

export function RuleSetRuleBuilder({ rule, accessibleResources, disabled, onRuleUpdated, onRemoveRule }: {
  rule: OrganizationRuleSetRule;
  accessibleResources: GetUserAccessibleResourcesResponse | undefined;
  disabled: boolean;
  onRuleUpdated(rule: OrganizationRuleSetRule): void;
  onRemoveRule(): void;
}) {
  const { isMobile } = useWindowSize();

  const setOfSelectedResources = new Set(rule.resources.filter((res) => res !== "*"));
  const selectedRoleInfo = roles.find((role) => role.key === rule.role);
  const namespaces = accessibleResources?.federatedGraphs.map((fg) => fg.namespace) ?? [];

  function setSelectedRole(role: string) {
    const newRole = roles.find((r) => r.key === role);
    if (!newRole) {
      return;
    }

    const newRule = rule.clone();
    newRule.role = role;
    onRuleUpdated(newRule);
  }

  function toggleResources(resources: string[]) {
    for (const res of resources) {
      if (setOfSelectedResources.has(res)) {
        setOfSelectedResources.delete(res);
      } else {
        setOfSelectedResources.add(res);
      }
    }

    const newRule = rule.clone();
    newRule.resources = Array.from(setOfSelectedResources);
    onRuleUpdated(newRule);
  }

  const children = (
    <>
      <RuleSetRuleBuilderCommand
        uniqueKey="namespaces"
        isMobile={isMobile}
        title="Namespace"
        resources={namespaces}
        selectedResources={setOfSelectedResources}
        toggleResources={toggleResources}
        getResourceKey={(res) => `ns-${res}`}
        getResourceLabel={(res) => res}
        getResourceValue={(res) => res}
      />

      <RuleSetRuleBuilderCommand
        uniqueKey="federated-graphs"
        isMobile={isMobile}
        title="Federated Graph"
        resources={accessibleResources?.federatedGraphs}
        selectedResources={setOfSelectedResources}
        toggleResources={toggleResources}
        getResourceKey={(res) => `fg-${res.targetId}`}
        getResourceLabel={(res) => res.name}
        getResourceValue={(res) => `${res.namespace}:federated_graph:${res.name}`}
      />

      <RuleSetRuleBuilderCommand
        uniqueKey="subgraphs"
        isMobile={isMobile}
        title="Subgraph"
        resources={accessibleResources?.subgraphs}
        selectedResources={setOfSelectedResources}
        toggleResources={toggleResources}
        getResourceKey={(res) => `sg-${res.targetId}`}
        getResourceLabel={(res) => res.name}
        getResourceValue={(res) => `${res.namespace}:subgraph:${res.name}`}
      />
    </>
  );

  return (
    <div className="grid grid-cols-2 gap-3 justify-start items-start">
      <div className="space-y-2">
        <Select
          value={rule.role}
          onValueChange={setSelectedRole}
          disabled={disabled}
        >
          <SelectTrigger className={!selectedRoleInfo ? "text-muted-foreground" : undefined}>
            <SelectValue aria-label={selectedRoleInfo?.displayName ?? "-"}>
              {selectedRoleInfo?.displayName ?? "Select a role"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.key} value={role.key}>{role.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div
          className={cn(
            "text-sm px-4",
            !!selectedRoleInfo ? "text-muted-foreground" : "text-destructive"
          )}
        >
          {selectedRoleInfo?.description ?? "A role must be selected"}
        </div>
      </div>
      <div className="flex justify-start items-start gap-x-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="link"
              className="px-0 justify-start grow truncate"
              disabled={disabled}
            >
              <span className="truncate">
                {setOfSelectedResources.size === 0
                  ? "No resources selected"
                  : `${setOfSelectedResources.size} resource(s) selected`}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72" align={isMobile ? "end" : "start"}>
            {isMobile
              ? (
                <Accordion
                  type="single"
                  collapsible
                  className="max-h-72 overflow-auto w-72"
                >
                  {children}
                </Accordion>
              )
              : (<DropdownMenuGroup>{children}</DropdownMenuGroup>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled={disabled}
          onClick={onRemoveRule}
        >
          <TrashIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function RuleSetRuleBuilderCommand<TData>({
  uniqueKey,
  isMobile,
  title,
  resources,
  selectedResources,
  toggleResources,
  getResourceKey,
  getResourceLabel,
  getResourceValue,
}: {
  uniqueKey: string;
  isMobile: boolean;
  title: string;
  resources?: TData[];
  selectedResources: Set<string>;
  toggleResources(resources: string[]): void;
  getResourceKey(res: TData): string;
  getResourceLabel(res: TData): string;
  getResourceValue(res: TData): string;
}) {
  const [searchValue, setSearchValue] = useState<string>();
  const filteredResources = useMemo(() => resources?.filter((res) =>
    !searchValue || getResourceLabel(res).toLowerCase().includes(searchValue.toLowerCase())
  ) ?? [], [resources, searchValue, getResourceLabel]);

  if (!resources?.length) {
    return null;
  }

  const filteredResourcesAsValue = filteredResources.map(getResourceValue);
  const currentSelectedResources = filteredResourcesAsValue.filter((res) => selectedResources.has(res));
  const unselectedResources = filteredResourcesAsValue.filter((res) => !selectedResources.has(res));
  const command = (
    <Command
      className="w-full min-w-72"
      filter={(value, search) => value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}>
      <div className="relative">
        <CommandInput
          placeholder={title}
          value={searchValue}
          onValueChange={setSearchValue}
        />
      </div>
      <CommandList>
        <CommandEmpty>No matching {title.toLowerCase()}</CommandEmpty>
        {filteredResources.map((res) => {
          const value = getResourceValue(res);
          const isChecked = selectedResources.has(value);

          return (
            <CommandItem
              key={getResourceKey(res)}
              onSelect={() => toggleResources([value])}
            >
              <div
                className={cn(
                  "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                  isChecked
                    ? "bg-primary text-primary-foreground"
                    : "opacity-50 [&_svg]:invisible"
                )}
              >
                <CheckIcon className="size-4" />
              </div>
              <span className="truncate">{getResourceLabel(res)}</span>
            </CommandItem>
          );
        })}
      </CommandList>

      <Separator orientation="horizontal" className="mt-1" />
      <div className="flex justify-center gap-x-2 pt-1">
        <Button
          variant="ghost"
          className="w-full justify-center text-center"
          disabled={unselectedResources.length === 0}
          onClick={() => toggleResources(unselectedResources)}
        >
          {unselectedResources.length === 0 ? "Selected All" : "Select All"}
        </Button>

        {currentSelectedResources.length > 0 && (
          <>
            <Separator orientation="vertical" className="h-9" />
            <Button
              variant="ghost"
              className="w-full justify-center text-center"
              onClick={() => toggleResources(currentSelectedResources)}
            >
              Clear Selection
            </Button>
          </>
        )}
      </div>
    </Command>
  );

  return isMobile
    ? (
      <AccordionItem value={uniqueKey}>
        <AccordionTrigger className="p-2">
          {title}
          <Badge>{selectedResources.size}</Badge>
        </AccordionTrigger>
        <AccordionContent>{command}</AccordionContent>
      </AccordionItem>
    )
    : (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          className="gap-1"
        >
          <span className="grow truncate">{title}</span>
          {currentSelectedResources.length > 0 && (
            <Badge className="text-xs px-2 py-0.5 pointer-events-none shrink-0">
              {currentSelectedResources.length}
            </Badge>
          )}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>{command}</DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    );
}