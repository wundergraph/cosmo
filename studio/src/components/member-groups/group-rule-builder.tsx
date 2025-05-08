import type {
  UpdateOrganizationGroupRequest_GroupRule,
  GetUserAccessibleResourcesResponse,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { roles as originalRoles } from "@/lib/constants";
import { useMemo, useState, createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { TrashIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
} from "@/components/ui/command";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { capitalize, cn } from "@/lib/utils";
import useWindowSize from "@/hooks/use-window-size";
import { CheckIcon } from "@heroicons/react/20/solid";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PopoverContentProps } from "@radix-ui/react-popover";
import { useFeature } from "@/hooks/use-feature";

type RoleMetadata = (typeof originalRoles)[number];
type BuilderContextType = {
  rule: UpdateOrganizationGroupRequest_GroupRule;
  roles: RoleMetadata[];
  categories: string[];
  rolesByCategory: Partial<Record<string, RoleMetadata[]>>;
  accessibleResources: GetUserAccessibleResourcesResponse | undefined;
};

const BuilderContext = createContext<BuilderContextType>({
  rule: null!, /** hack **/
  roles: originalRoles,
  categories: [],
  rolesByCategory: {},
  accessibleResources: undefined,
});

export function GroupRuleBuilder({ roles, rule, accessibleResources, disabled, onRuleUpdated, onRemoveRule }: {
  roles: RoleMetadata[];
  rule: UpdateOrganizationGroupRequest_GroupRule;
  accessibleResources: GetUserAccessibleResourcesResponse | undefined;
  disabled: boolean;
  onRuleUpdated(rule: UpdateOrganizationGroupRequest_GroupRule): void;
  onRemoveRule(): void;
}) {
  const { isMobile } = useWindowSize();
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const activeRole = originalRoles.find((r) => r.key === rule.role);
  const rbac = useFeature("rbac");

  const context = useMemo<BuilderContextType>(() => {
    const rolesByCategories = Object.groupBy(roles, (r) => r.category);
    return {
      rule,
      roles,
      categories: Object.keys(rolesByCategories),
      rolesByCategory: rolesByCategories,
      accessibleResources,
    };
  }, [rule, roles, accessibleResources]);

  const onSelectRole = (role: string) => {
    const newSelectedRole = originalRoles.find((r) => r.key === role);
    if (!newSelectedRole) {
      return;
    }

    setPopoverOpen(false);

    const newRule = rule.clone();
    newRule.role = role;
    newRule.resources = [];
    onRuleUpdated(newRule);
  };

  return (
    <BuilderContext.Provider value={context}>
      <div className="grid grid-cols-2 gap-3 justify-start items-start">
        <div className="gap-y-20">
          <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={disabled || !rbac?.enabled}
                className="w-full justify-start"
              >
                <span className={cn('truncate', !activeRole && 'text-muted-foreground')}>
                  {activeRole ? (
                    <span className="flex justify-start items-center gap-x-1">
                      <span>
                        {capitalize(activeRole.category).replace('-', ' ')}
                      </span>
                      <ChevronRightIcon className="size-3 text-muted-foreground" />
                      <span className="truncate">{activeRole.displayName}</span>
                    </span>
                  ) : "Select a role"}
                </span>
              </Button>
            </PopoverTrigger>

            <HackyPopoverContent
              className="p-0 w-[calc(100vw-54px)] sm:w-[350px] md:w-[500px]"
              align="start"
            >
              {!isMobile
                ? <RolesCommand onSelectRole={onSelectRole} />
                : <RolesAccordion onSelectRole={onSelectRole} />}
            </HackyPopoverContent>
          </Popover>
        </div>

        <div className="flex justify-start items-start gap-x-2">
          {activeRole && activeRole.category !== 'organization' ? (
            <ResourcesDropdown
              disabled={disabled}
              onRuleUpdated={onRuleUpdated}
              isNamespaceRole={activeRole?.category === "namespace"}
            />
          ) : (<div className="grow h-9 text-sm flex justify-start items-center text-muted-foreground">
            Grants access to all resources.
          </div>)}

          {rbac?.enabled && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              disabled={disabled}
              onClick={onRemoveRule}
            >
              <TrashIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </BuilderContext.Provider>
  );
}

// There is an issue with Radix where having a scrollable area inside a popover, where scrolling the
// content inside the popover doesn't work. Because of this we are adding `onWheel` and `onTouchMove` to the
// `PopoverContent` to prevent that component from blocking the scroll.
//
// See: https://github.com/radix-ui/primitives/issues/1159
function HackyPopoverContent(props: Omit<PopoverContentProps, 'onWheel' | 'onTouchMove'>) {
  return (
    <PopoverContent
      onWheel={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      {...props}
    />
  );
}

function RolesCommand({ onSelectRole }: { onSelectRole(role: string): void; }) {
  const [searchValue, setSearchValue] = useState('');
  const trimmedSearchValue = searchValue.trim().toLowerCase();
  const { roles, categories, rolesByCategory } = useContext(BuilderContext);

  const [selectedCategory, setSelectedCategory] = useState(categories[0]);
  const rolesForSelectedCategory = rolesByCategory[selectedCategory] ?? [];
  const filteredRoles = trimmedSearchValue.length > 0
    ? roles.filter((r) => Boolean(
      r.displayName.toLowerCase().includes(trimmedSearchValue) ||
      r.description?.toLowerCase().includes(trimmedSearchValue)
    ))
    : roles;

  return (
    <Command
      className="flex"
      shouldFilter={false}
      value={trimmedSearchValue.length > 0 ? undefined : selectedCategory}
      onValueChange={trimmedSearchValue.length > 0 ? undefined : setSelectedCategory}
    >
      <div className="w-full">
        <CommandInput
          placeholder="Filter by role"
          onValueChange={setSearchValue}
        />
      </div>

      {trimmedSearchValue.length > 0 ? (
        filteredRoles.length > 0 ? (
          <CommandList>
            <CommandGroup heading="Roles">
              {filteredRoles.map((role) => (
                <CommandRoleItem
                  key={`role-${role.key}`}
                  name={role.displayName}
                  description={role.description}
                  onSelect={() => onSelectRole(role.key)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        ) : (
          <div className="p-6 text-center text-muted-foreground text-sm pointer-events-none select-none">
            No matches for &quot;{searchValue}&quot;.
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 divide-x">
          <CommandList cmdk-framer-left="">
            <CommandGroup heading="Categories">
              {categories.map((cat) => (
                <CommandItem
                  key={`category-${cat}`}
                  value={cat}
                  onSelect={() => {}}
                >
                  {capitalize(cat.replace('-', ' '))}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>

          <div cmdk-framer-right="">
            <Command>
              <CommandList>
                <CommandGroup heading="Roles">
                  {rolesForSelectedCategory.map((role) => (
                    <CommandRoleItem
                      key={`role-${role.key}`}
                      name={role.displayName}
                      description={role.description}
                      onSelect={() => onSelectRole(role.key)}
                    />
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </div>
      )}
    </Command>
  );
}

function CommandRoleItem({ name, description, onSelect }: {
  name: string;
  description?: string;
  onSelect(): void;
}) {
  return (
    <CommandItem
      value={name}
      className="gap-y-1 flex-col justify-start items-start"
      onSelect={onSelect}
    >
      {name}
      {description && <div className="text-muted-foreground text-sm">{description}</div>}
    </CommandItem>
  );
}

function RolesAccordion({ onSelectRole }: { onSelectRole(role: string): void; }) {
  const { rolesByCategory } = useContext(BuilderContext);
  return (
    <Accordion type="single" collapsible>
      {Object.entries(rolesByCategory).map(([cat, roles]) => (
        <AccordionItem key={`category-${cat}`} value={cat}>
          <AccordionTrigger className="px-2">
            {capitalize(cat).replace('-', ' ')}
          </AccordionTrigger>

          <AccordionContent className="px-1">
            <Command>
              <CommandList>
                {roles!.map((role) => (
                  <CommandRoleItem
                    key={`role-${role.key}`}
                    name={role.displayName}
                    description={role.description}
                    onSelect={() => onSelectRole(role.key)}
                  />
                ))}
              </CommandList>
            </Command>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ResourcesDropdown({ disabled, isNamespaceRole, onRuleUpdated }: {
  disabled: boolean;
  isNamespaceRole: boolean;
  onRuleUpdated(rule: UpdateOrganizationGroupRequest_GroupRule): void;
}) {
  const { rule, accessibleResources } = useContext(BuilderContext);
  const [searchValue, setSearchValue] = useState<string>();

  const resources = useMemo(() => {
    let result: { group: string; value: string; label: string; isNamespace: boolean }[] = [
      ...(accessibleResources?.federatedGraphs.map((fg) => ({
        group: 'namespaces',
        value: fg.namespace,
        label: fg.namespace,
        isNamespace: true,
      })) ?? [])
    ];

    if (!isNamespaceRole) {
      result.push(
        ...(accessibleResources?.federatedGraphs.map((fg) => ({
          group: `${fg.namespace} federated graphs`,
          value: fg.targetId,
          label: fg.name,
          isNamespace: false,
        })) ?? [])
      );

      result.push(
        ...(accessibleResources?.subgraphs.map((sg) => ({
          group: `${sg.namespace} subgraphs`,
          value: sg.targetId,
          label: sg.name,
          isNamespace: false,
        })) ?? [])
      );
    }

    const q = searchValue?.trim().toLowerCase();
    if (q) {
      result = result.filter((item) => item.label.toLowerCase().includes(q));
    }

    return Object.groupBy(result, (item) => item.group);
  }, [accessibleResources?.federatedGraphs, accessibleResources?.subgraphs, isNamespaceRole, searchValue]);

  if (!accessibleResources?.response) {
    return null;
  }

  const toggleResource = (res: string, isNamespace: boolean) => {
    const newRule = rule.clone();
    const setOfSelectedResources = new Set(isNamespace ? rule.namespaces : rule.resources);
    if (setOfSelectedResources.has(res)) {
      setOfSelectedResources.delete(res);
    } else {
      setOfSelectedResources.add(res);
    }

    if (isNamespace) {
      newRule.namespaces = Array.from(setOfSelectedResources);
    } else {
      newRule.resources = Array.from(setOfSelectedResources);
    }

    onRuleUpdated(newRule);
  };

  const onOpenChange = (open: boolean) => {
    if (open) {
      setSearchValue('');
    }
  };

  const selectedResources = rule.namespaces.length + rule.resources.length;
  return (
    <Popover onOpenChange={onOpenChange}>
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
      <HackyPopoverContent className="p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Filter resources"
            onValueChange={setSearchValue}
          />
          <CommandEmpty className="p-6 text-center text-muted-foreground text-sm pointer-events-none select-none">
            No resource matches &quot;{searchValue}&quot;
          </CommandEmpty>
          <CommandList>
            {Object.entries(resources).map(([heading, items], index) => (
              <CommandGroup key={`group-${index}`} heading={heading}>
                {items?.map((item) => (
                  <CommandItem
                    key={`item-${item.value}`} value={item.value}
                    onSelect={() => toggleResource(item.value, item.isNamespace)}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center",
                        rule.namespaces.includes(item.value) || rule.resources.includes(item.value)
                          ? "text-primary-foreground"
                          : "[&_svg]:invisible"
                      )}
                    >
                      <CheckIcon className="size-4" />
                    </div>
                    <span className="truncate">{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </HackyPopoverContent>
    </Popover>
  );
}
