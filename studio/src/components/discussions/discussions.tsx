import { CommentCard } from "@/components/discussions/discussion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { ArrowRightIcon, CheckCircledIcon } from "@radix-ui/react-icons";
import { Separator } from "@radix-ui/react-separator";
import { useQuery } from "@tanstack/react-query";
import {
  getOrganizationMembers,
  getAllDiscussions,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { Discussion } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Fuse from "fuse.js";
import Link from "next/link";
import { useRouter } from "next/router";
import { Loader } from "../ui/loader";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { EmptyState } from "../empty-state";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { PiChat } from "react-icons/pi";

const Discussions = ({
  discussions,
  refetch,
}: {
  discussions: Record<string, Discussion[]>;
  refetch: () => void;
}) => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.slug as string;

  const user = useUser();

  const { data: membersData } = useQuery({
    ...getOrganizationMembers.useQuery(),
    queryKey: [
      user?.currentOrganization.slug || "",
      "GetOrganizationMembers",
      {},
    ],
  });

  const search = router.query.search as string;

  const fuse = new Fuse(Object.keys(discussions), {
    minMatchCharLength: 1,
  });

  const filtered = search
    ? Object.fromEntries(
        fuse.search(search).map((key) => [key.item, discussions[key.item]]),
      )
    : discussions;

  return (
    <>
      <ol className="relative flex w-full flex-1 flex-col divide-y">
        {Object.entries(filtered).map(([schemaVersionId, discussions]) => {
          return (
            <div
              className="flex w-full flex-col items-start gap-x-12 gap-y-4 py-8 first:pt-0"
              key={schemaVersionId}
            >
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-bold">
                  <span className="text-muted-foreground">Schema version:</span>{" "}
                  {schemaVersionId.slice(0, 6)}
                </h3>
              </div>
              <div className="grid w-full flex-1 grid-cols-1 gap-4 pt-2 md:grid-cols-2 xl:grid-cols-3">
                {discussions.map((ld) => {
                  return (
                    <div
                      key={ld.id}
                      className="flex h-auto w-full max-w-2xl flex-col rounded-md border pb-2 pt-4"
                    >
                      <CommentCard
                        isOpeningComment
                        discussionId={ld.id}
                        comment={ld.openingComment!}
                        author={membersData?.members.find(
                          (m) => m.userID === ld.openingComment?.createdBy,
                        )}
                        onUpdate={() => refetch()}
                        onDelete={() => refetch()}
                      />
                      <Separator className="mb-2 mt-4" />

                      <div className="mt-auto flex items-center gap-4 px-4">
                        {ld.isResolved && (
                          <Badge variant="outline" className="gap-2 py-1.5">
                            <CheckCircledIcon className="h-4 w-4 text-success" />{" "}
                            <span>Resolved</span>
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          className="ml-auto w-max flex-shrink-0"
                          asChild
                        >
                          <Link
                            href={`/${organizationSlug}/graph/${slug}/discussions/${ld.id}`}
                          >
                            View thread <ArrowRightIcon className="ml-2" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </ol>
    </>
  );
};

export const GraphDiscussions = ({
  targetId,
  linkToSchema,
}: {
  targetId?: string;
  linkToSchema: string;
}) => {
  const router = useRouter();
  const resolved = router.query.resolved as string;

  const { data, isLoading, error, refetch } = useQuery({
    ...getAllDiscussions.useQuery({
      targetId: targetId,
      schemaVersionId: undefined,
    }),
    enabled: !!targetId,
  });

  const discussionsBySchema = data?.discussions
    .filter((d) => d.isResolved === !!resolved)
    .reduce(
      (acc, discussion) => {
        const schemaVersionId = discussion.schemaVersionId;

        if (!acc[schemaVersionId]) {
          acc[schemaVersionId] = [];
        }

        acc[schemaVersionId].push(discussion);

        return acc;
      },
      {} as Record<string, Discussion[]>,
    );

  return (
    <>
      {isLoading && <Loader fullscreen />}
      {(error || data?.response?.code !== EnumStatusCode.OK) && (
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve discussions"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      )}
      {discussionsBySchema && (
        <Discussions
          discussions={discussionsBySchema}
          refetch={() => refetch()}
        />
      )}
      {Object.keys(discussionsBySchema ?? {}).length === 0 && !isLoading && (
        <EmptyState
          icon={<PiChat />}
          title="No discussions found"
          description={"You can start a new one from the schema page"}
          actions={
            <Button asChild>
              <Link href={linkToSchema}>Take me there</Link>
            </Button>
          }
        />
      )}
    </>
  );
};
