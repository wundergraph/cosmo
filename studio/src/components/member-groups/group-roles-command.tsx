import { ReactNode, useState } from "react";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { capitalize } from "@/lib/utils";
import { roles as originalRoles } from "@/lib/constants";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

export function GroupRolesCommand({ roles, categories, rolesByCategory, onSelectRole }: {
  roles: (typeof originalRoles)[number][];
  categories: string[];
  rolesByCategory: Partial<Record<string, (typeof originalRoles)[number][]>>;
  onSelectRole(role: string): void;
}) {
  const [searchValue, setSearchValue] = useState('');
  const trimmedSearchValue = searchValue.trim().toLowerCase();

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
                  key={`role-${role.category}-${role.key}`}
                  value={role.key}
                  label={(
                    <span className="flex justify-start items-center gap-x-1">
                      <span>
                        {capitalize(role.category).replace('-', ' ')}
                      </span>
                      <ChevronRightIcon className="size-3 text-muted-foreground" />
                      <span className="truncate">{role.displayName}</span>
                    </span>
                  )}
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
                      value={role.key}
                      label={role.displayName}
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

export function GroupRolesAccordion({ rolesByCategory, onSelectRole }: {
  rolesByCategory: Partial<Record<string, (typeof originalRoles)[number][]>>;
  onSelectRole(role: string): void;
}) {
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
                    value={role.key}
                    label={role.displayName}
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

function CommandRoleItem({ value, label, description, onSelect }: {
  value: string;
  label: ReactNode;
  description?: string;
  onSelect(): void;
}) {
  return (
    <CommandItem
      value={value}
      className="gap-y-1 flex-col justify-start items-start"
      onSelect={onSelect}
    >
      {label}
      {description && <div className="text-muted-foreground text-sm">{description}</div>}
    </CommandItem>
  );
}