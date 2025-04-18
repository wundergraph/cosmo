import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getOrganizationRuleSets
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useState } from "react";
import type { OrganizationRuleSet } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { DeleteRuleSetDialog } from "@/components/member-groups/delete-rule-set-dialog";
import { RuleSetSheet } from "@/components/member-groups/rule-set-sheet";
import { CreateRuleSetDialog } from "@/components/member-groups/create-rule-set-dialog";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/table";
import { RuleSetRow } from "@/components/member-groups/rule-set-row";

const GroupsToolbar = () => {
  return null;
}

const GroupsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const [selectedRuleSet, setSelectedRuleSet] = useState<OrganizationRuleSet | null>(null);
  const [openDeleteRuleSetDialog, setOpenDeleteRuleSetDialog] = useState(false);

  const { data, isLoading, error, refetch } = useQuery(getOrganizationRuleSets);
  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the member groups of this organization."
        description={data?.response?.details || error?.message || "Please try again"}
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const ruleSets = data?.ruleSets ?? [];
  const activeRuleSetId = router.query?.ruleSet as string;
  const activeRuleSet = activeRuleSetId ? ruleSets.find((ruleSet) => ruleSet.ruleSetId === activeRuleSetId) : undefined;

  const openRuleSet = (ruleSet: OrganizationRuleSet) => {
    router.replace({
      pathname: router.pathname,
      query: {
        ...router.query,
        ruleSet: ruleSet.ruleSetId,
      },
    });
  };

  const createRuleSet = (
    <CreateRuleSetDialog
      existingRuleSetNames={ruleSets.map((group) => group.name.toLowerCase())}
      onRuleSetCreated={async (ruleSet) => {
        await refetch();
        openRuleSet(ruleSet);
      }}
    />
  );

  return (
    <>
      <RuleSetSheet
        ruleSet={activeRuleSet}
        onRuleSetUpdated={refetch}
        onOpenChange={(open) => {
          if (!open) {
            const { ruleSet, ...restQuery } = router.query;
            router.replace({
              pathname: router.pathname,
              query: restQuery,
            });
          }
        }}
      />

      {ruleSets.length === 0 ? (
        <EmptyState
          icon={<UserGroupIcon />}
          title="Create a Rule Set"
          description="No rule sets found."
          actions={
            <div className="mt-2">
              {createRuleSet}
            </div>
          }
        />
      ) : (
        <div className="flex h-full flex-col gap-y-6">
          <DeleteRuleSetDialog
            open={openDeleteRuleSetDialog}
            ruleSet={selectedRuleSet}
            onRuleSetDeleted={refetch}
            onOpenChange={setOpenDeleteRuleSetDialog}
          />

          <div className="flex flex-col justify-end gap-y-4 md:flex-row md:items-center">
            {createRuleSet}
          </div>

          <TableWrapper className="max-h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-full">Name</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead/>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ruleSets.map((group) => (
                  <RuleSetRow
                    key={group.ruleSetId}
                    ruleSet={group}
                    onSelect={() => openRuleSet(group)}
                    onDelete={() => {
                      setSelectedRuleSet(group);
                      setOpenDeleteRuleSetDialog(true);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </div>
      )}
    </>
  );
}

GroupsPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Groups",
    "An overview of all your federated graphs and monographs",
    null,
    <GroupsToolbar />,
  );
};

export default GroupsPage;