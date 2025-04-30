import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { createConnectQueryKey, useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getOrganizationGroups
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useState } from "react";
import type { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { DeleteMemberGroupDialog } from "@/components/member-groups/delete-member-group-dialog";
import { MemberGroupSheet } from "@/components/member-groups/member-group-sheet";
import { CreateMemberGroupDialog } from "@/components/member-groups/create-member-group-dialog";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/table";
import { MemberGroupRow } from "@/components/member-groups/member-group-row";
import { useQueryClient } from "@tanstack/react-query";
import { Toolbar } from "@/components/ui/toolbar";

const GroupsToolbar = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryKey = createConnectQueryKey(getOrganizationGroups);

  return (
    <Toolbar className="w-auto">
      <CreateMemberGroupDialog
        onGroupCreated={async (group) => {
          await queryClient.refetchQueries({ queryKey, exact: true });
          await router.replace({
            pathname: router.pathname,
            query: {
              ...router.query,
              group: group.groupId,
            },
          });
        }}
      />
    </Toolbar>
  );
}

const GroupsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const [selectedGroup, setSelectedGroup] = useState<OrganizationGroup | null>(null);
  const [openDeleteGroupDialog, setOpenDeleteGroupDialog] = useState(false);

  const { data, isLoading, error, refetch } = useQuery(getOrganizationGroups);
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

  const groups = data?.groups ?? [];
  const activeGroupId = router.query?.group as string;
  const activeGroup = activeGroupId ? groups.find((g) => g.groupId === activeGroupId) : undefined;

  const openGroup = (group: OrganizationGroup) => {
    router.replace({
      pathname: router.pathname,
      query: {
        ...router.query,
        group: group.groupId,
      },
    });
  };

  return (
    <>
      <MemberGroupSheet
        group={activeGroup}
        onGroupUpdated={refetch}
        onOpenChange={(open) => {
          if (!open) {
            const { group, ...restQuery } = router.query;
            router.replace({
              pathname: router.pathname,
              query: restQuery,
            });
          }
        }}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={<UserGroupIcon />}
          title="Create a group"
          description="No member groups found."
          actions={
            <div className="mt-2">
              <CreateMemberGroupDialog
                onGroupCreated={async (group) => {
                  await refetch();
                  openGroup(group);
                }}
              />
            </div>
          }
        />
      ) : (
        <div className="flex h-full flex-col gap-y-6">
          <DeleteMemberGroupDialog
            open={openDeleteGroupDialog}
            group={selectedGroup}
            existingGroups={groups}
            onGroupDeleted={refetch}
            onOpenChange={setOpenDeleteGroupDialog}
          />

          <TableWrapper className="max-h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64">Name</TableHead>
                  <TableHead className="w-full">Description</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead/>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <MemberGroupRow
                    key={group.groupId}
                    group={group}
                    onSelect={() => openGroup(group)}
                    onDelete={() => {
                      setSelectedGroup(group);
                      setOpenDeleteGroupDialog(true);
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