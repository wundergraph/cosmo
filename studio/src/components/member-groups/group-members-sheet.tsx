import { OrganizationGroup } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  getOrganizationGroupMembers,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useQuery } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { EmptyState } from "@/components/empty-state";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { useState } from "react";

export function GroupMembersSheet({ open, group, onOpenChange }: {
  open: boolean;
  group: OrganizationGroup | undefined;
  onOpenChange(open: boolean): void;
}) {
  const [previousGroup, setPreviousGroup] = useState<OrganizationGroup | undefined>();
  const currentGroup = group || previousGroup;
  const { data, isLoading, error, refetch } = useQuery(
    getOrganizationGroupMembers,
    { groupId: currentGroup?.groupId},
    { enabled: open && !!group, }
  );

  const onSheetOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setPreviousGroup(group);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onSheetOpenChange}>
      <SheetContent className="scrollbar-custom w-full max-w-full overflow-y-scroll sm:max-w-full md:max-w-xl">
        <SheetHeader>
          <SheetTitle>Members of &quot;{currentGroup?.name}&quot;</SheetTitle>
          {currentGroup?.description && (
            <SheetDescription>
              {currentGroup.description}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="mt-3">
          {isLoading ? (
            <div className="flex h-[320px] md:h-[520px] w-full items-center justify-center rounded-md">
              <Loader />
            </div>
          ) : (
            <>
              {error || data?.response?.code !== EnumStatusCode.OK ? (
                <EmptyState
                  icon={<ExclamationTriangleIcon />}
                  title="Could not retrieve the members for this group."
                  description={data?.response?.details || error?.message || "Please try again"}
                  actions={<Button onClick={() => refetch()}>Retry</Button>}
                />
              ) : (
                data.members.length > 0 ? (
                  <div className="rounded-md border border-border divide-y">
                    {data.members.map((member) => (
                      <div key={`member-${member.id}`} className="p-2">
                        {member.email}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<ExclamationTriangleIcon />}
                    title="No member have been added to this group."
                    description={"Assign users to this group on the members page."}
                  />
                )
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}