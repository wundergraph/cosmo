import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  DotsVerticalIcon,
  ExitIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  deleteDiscussionComment,
  getAllDiscussions,
  getDiscussion,
  getOrganizationMembers,
  setDiscussionResolution,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext } from "react";
import { useApplyParams } from "../analytics/use-apply-params";
import { EmptyState } from "../empty-state";
import { GraphContext } from "../layout/graph-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Loader } from "../ui/loader";
import { useToast } from "../ui/use-toast";
import { CommentCard, NewComment } from "./discussion";

export const Thread = ({
  schemaVersionId,
  onDelete,
  displayHideButton,
}: {
  schemaVersionId?: string;
  onDelete?: () => void;
  displayHideButton?: boolean;
}) => {
  const router = useRouter();
  const discussionId = router.query.discussionId as string;

  const graph = useContext(GraphContext);

  const { toast } = useToast();

  const applyParams = useApplyParams();
  const client = useQueryClient();

  const user = useUser();

  const { data: membersData } = useQuery({
    ...getOrganizationMembers.useQuery(),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetOrganizationMembers",
      {},
    ],
  });

  const {
    data: discussionData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...getDiscussion.useQuery({
      discussionId,
    }),
    enabled: !!discussionId,
  });

  const { mutate: deleteDiscussion } = useMutation({
    ...deleteDiscussionComment.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: `Could not delete discussion`,
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      toast({
        title: `Discussion deleted successfully`,
      });

      client.invalidateQueries({
        queryKey: getAllDiscussions.getQueryKey({
          schemaVersionId,
          targetId: discussionData?.discussion?.targetId,
        }),
      });

      onDelete?.();
    },
  });

  const { mutate: resolveDiscussion } = useMutation({
    ...setDiscussionResolution.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: `Could not update discussion status`,
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      toast({
        title: `Discussion status updated`,
      });

      client.invalidateQueries({
        queryKey: getAllDiscussions.getQueryKey({
          schemaVersionId,
          targetId: discussionData?.discussion?.targetId,
        }),
      });

      refetch();
    },
  });

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || discussionData?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve discussion thread"
        description={
          discussionData?.response?.details ||
          error?.message ||
          "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-custom relative flex flex-1 flex-col overflow-y-auto">
        {discussionData.comments.map((dc, idx) => {
          return (
            <div key={dc.id} className="relative pb-8 first:pt-4">
              <div
                className={cn(
                  "absolute left-6 mt-2 h-full w-1 border-r-2",
                  idx === discussionData.comments.length - 1 && "hidden",
                )}
              />
              <CommentCard
                discussionId={discussionId}
                comment={dc}
                isOpeningComment={idx === 0}
                author={membersData?.members.find(
                  (m) => m.userID === dc?.createdBy,
                )}
                onUpdate={refetch}
                onDelete={onDelete}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-start gap-x-2 border-t p-2">
        <NewComment discussionId={discussionId} refetch={() => refetch()} />
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="secondary">
                <DotsVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild className="text-destructive">
                <AlertDialogTrigger className="w-full">
                  <TrashIcon className="mr-2" />
                  Delete
                </AlertDialogTrigger>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  resolveDiscussion({
                    discussionId,
                    isResolved: !discussionData?.discussion?.isResolved,
                  });
                }}
              >
                {discussionData?.discussion?.isResolved ? (
                  <>
                    <CrossCircledIcon className="mr-2" />
                    Mark as unresolved
                  </>
                ) : (
                  <>
                    <CheckCircledIcon className="mr-2" />
                    Mark as resolved
                  </>
                )}
              </DropdownMenuItem>
              {displayHideButton && (
                <DropdownMenuItem
                  onClick={() => {
                    applyParams({
                      discussionId: null,
                    });
                  }}
                >
                  <ExitIcon className="mr-2" />
                  Hide
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will delete the discussion
                and associated replies.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  deleteDiscussion({
                    discussionId,
                    commentId: discussionData.comments[0]?.id,
                  });
                }}
              >
                Delete Discussion
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export const ThreadSheet = ({
  schemaVersionId,
}: {
  schemaVersionId?: string;
}) => {
  const router = useRouter();
  const discussionId = router.query.discussionId as string;
  const applyParams = useApplyParams();

  return (
    <Sheet
      open={!!discussionId}
      onOpenChange={(val) => {
        if (!val) {
          applyParams({
            discussionId: null,
          });
        }
      }}
    >
      <SheetContent className="w-screen px-0 pb-0 pt-12 lg:w-full lg:max-w-lg">
        <div className="h-full w-full px-4">
          <Thread schemaVersionId={schemaVersionId} displayHideButton />
        </div>
      </SheetContent>
    </Sheet>
  );
};
