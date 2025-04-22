import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OrganizationRuleSet, OrganizationRuleSetRule } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  getUserAccessibleResources,
  updateOrganizationRuleSet,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { RuleSetRuleBuilder } from "@/components/member-groups/rule-set-rule-builder";
import { useState } from "react";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useToast } from "@/components/ui/use-toast";

export function RuleSetSheet({ ruleSet, onRuleSetUpdated, onOpenChange }: {
  ruleSet?: OrganizationRuleSet;
  onRuleSetUpdated(): Promise<unknown>;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Sheet open={!!ruleSet} onOpenChange={onOpenChange}>
      <SheetContent className="scrollbar-custom w-full max-w-full overflow-y-scroll sm:max-w-full md:max-w-2xl lg:max-w-3xl">
        {!ruleSet
          ? null
          : (
            <RuleSetSheetContent
              ruleSet={ruleSet}
              onRuleSetUpdated={async () => {
                await onRuleSetUpdated();
                onOpenChange(false);
              }}
              onCancel={() => onOpenChange(false)}
            />
          )}
      </SheetContent>
    </Sheet>
  );
}

function RuleSetSheetContent({ ruleSet, onRuleSetUpdated, onCancel }: {
  ruleSet: OrganizationRuleSet;
  onRuleSetUpdated(): void;
  onCancel(): void;
}) {
  const { data } = useQuery(getUserAccessibleResources);
  const [ruleSetRules, setRuleSetRules] = useState<OrganizationRuleSetRule[]>([...ruleSet.rules]);
  const { toast } = useToast();

  const ruleSetCanBeModified = !ruleSet?.builtin;
  const allRulesHaveRole = ruleSetRules.every((rule) => !!rule.role);
  const { mutate, isPending } = useMutation(updateOrganizationRuleSet);

  const onSaveClick = () => {
    if (!allRulesHaveRole || !ruleSetCanBeModified) {
      return;
    }

    mutate(
      {
        ruleSetId: ruleSet.ruleSetId,
        rules: ruleSetRules.map((rule) => {
          if (rule.resources.length > 0) {
            return rule;
          }

          const newRule = rule.clone();
          newRule.resources = ["*"];
          return newRule;
        }),
      },
      {
        onSuccess(resp) {
          if (resp?.response?.code === EnumStatusCode.OK) {
            onRuleSetUpdated();
          } else {
            toast({
              description: resp?.response?.details ?? "Could not update the rule set. Please try again.",
              duration: 3000,
            });
          }
        },
        onError() {
          toast({
            description: "Could not update the rule set. Please try again.",
            duration: 3000,
          });
        },
      }
    );
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>Rules for &quot;{ruleSet.name}&quot;</SheetTitle>
        <SheetDescription>Blah blah blah description</SheetDescription>
      </SheetHeader>

      {ruleSetCanBeModified ? (
        <div className="my-6 space-y-3">
          {ruleSetRules.length
            ? (
              ruleSetRules.map((rule, index) => (
                <RuleSetRuleBuilder
                  key={`rule-${rule.role}-${index}`}
                  rule={rule}
                  accessibleResources={data}
                  disabled={isPending}
                  onRuleUpdated={(newRule) => {
                    const newRuleSetRules = [...ruleSetRules];
                    newRuleSetRules[index] = newRule;
                    setRuleSetRules(newRuleSetRules);
                  }}
                  onRemoveRule={() => {
                    const newRuleSetRules = [...ruleSetRules];
                    newRuleSetRules.splice(index, 1);
                    setRuleSetRules(newRuleSetRules);
                  }}
                />
              ))
            )
            : (
              <div className="border rounded-lg flex justify-start items-center gap-x-2 px-4 py-3">
                <ExclamationTriangleIcon className="size-4" />
                <span>No rules have been added to this rule set.</span>
              </div>
            )
          }

          <div>
            <Button
              variant="link"
              className="gap-x-2"
              onClick={() => {
                setRuleSetRules([
                  ...ruleSetRules,
                  OrganizationRuleSetRule.fromJson({}),
                ])
              }}
            >
              <PlusIcon className="size-4" />
              <span>Add rule</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="my-6 p-3 flex justify-start items-center gap-x-2">
          <ExclamationTriangleIcon className="size-4" />
          Builtin rule sets cannot be modified.
        </div>
      )}

      <SheetFooter className="gap-y-2">
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          {ruleSetCanBeModified ? "Cancel" : "Close"}
        </Button>

        {ruleSetCanBeModified && (
          <Button
            disabled={isPending || !allRulesHaveRole}
            isLoading={isPending}
            onClick={onSaveClick}
          >
            Save
          </Button>
        )}
      </SheetFooter>
    </>
  );
}
