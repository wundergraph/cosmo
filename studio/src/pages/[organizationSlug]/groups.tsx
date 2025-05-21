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
import { DeleteGroupDialog } from "@/components/member-groups/delete-group-dialog";
import { GroupSheet } from "@/components/member-groups/group-sheet";
import { CreateGroupDialog } from "@/components/member-groups/create-group-dialog";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/table";
import { GroupRow } from "@/components/member-groups/group-row";
import { useQueryClient } from "@tanstack/react-query";
import { Toolbar } from "@/components/ui/toolbar";
import { useFeature } from "@/hooks/use-feature";
import { GroupMembersSheet } from "@/components/member-groups/group-members-sheet";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { docsBaseURL } from "@/lib/constants";

const GroupsToolbar = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryKey = createConnectQueryKey(getOrganizationGroups);

  return (
    <Toolbar className="w-auto">
      <CreateGroupDialog
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
  const router = useRouter()
  const checkUserAccess = useCheckUserAccess();
  const rbac = useFeature("rbac");

  const isAdminOrDeveloper = checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] });
  const [selectedGroup, setSelectedGroup] = useState<OrganizationGroup | null>(null);
  const [openDeleteGroupDialog, setOpenDeleteGroupDialog] = useState(false);

  const { data, isLoading, error, refetch } = useQuery(getOrganizationGroups);

  const groups = data?.groups ?? [];
  const activeGroupId = router.query?.group as string;
  const showActiveGroupMembers = router.query?.showMembers === 'y';
  const activeGroup = activeGroupId
    ? groups.find((g) => g.groupId === activeGroupId)
    : undefined;

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the groups for this organization."
        description={data?.response?.details || error?.message || "Please try again"}
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const openSheet = (group: OrganizationGroup, showMembers: boolean) => {
    router.replace({
      pathname: router.pathname,
      query: {
        ...router.query,
        group: group.groupId,
        ...(showMembers ? { showMembers: 'y' } : {})
      },
    });
  };

  const onSheetOpenChange = (open: boolean) => {
    if (!open) {
      const { group, showMembers, ...restQuery } = router.query;
      router.replace({
        pathname: router.pathname,
        query: restQuery,
      });
    }
  };

  return (
    <>
      <GroupSheet
        open={!!activeGroup && !showActiveGroupMembers}
        group={activeGroup}
        onGroupUpdated={refetch}
        onOpenChange={onSheetOpenChange}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={<UserGroupIcon />}
          title="Create a group"
          description="No member groups found."
          actions={
            <div className="mt-2">
              <CreateGroupDialog
                onGroupCreated={async (group) => {
                  await refetch();
                  openSheet(group, false);
                }}
              />
            </div>
          }
        />
      ) : (
        <>
          <DeleteGroupDialog
            open={openDeleteGroupDialog}
            group={selectedGroup}
            existingGroups={groups}
            onGroupDeleted={refetch}
            onOpenChange={setOpenDeleteGroupDialog}
          />

          <GroupMembersSheet
            open={!!activeGroup && showActiveGroupMembers}
            group={activeGroup}
            onOpenChange={onSheetOpenChange}
          />

          <div className="flex h-full flex-col gap-y-4">
            <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
              <p className="text-muted-foreground text-sm">
                Groups are used to control the access to resources in the organization.{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={docsBaseURL + "/studio/groups"}
                  className="text-primary"
                >
                  Learn more.
                </a>
              </p>
            </div>

            <TableWrapper className="max-h-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-64">Name</TableHead>
                    <TableHead className="w-full">Description</TableHead>
                    <TableHead>Members</TableHead>
                    {rbac?.enabled && isAdminOrDeveloper && <TableHead/>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => (
                    <GroupRow
                      key={group.groupId}
                      group={group}
                      rbacEnabled={rbac?.enabled ?? false}
                      onSelect={(showMembers) => openSheet(group, showMembers)}
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
        </>
      )}
    </>
  );
}

GroupsPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Groups",
    "Manage all the groups of your organization.",
    null,
    <GroupsToolbar />,
  );
};

export default GroupsPage;