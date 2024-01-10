import { DiscussionSchemas } from "@/components/discussions/schemas";
import { Thread } from "@/components/discussions/thread";
import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toolbar } from "@/components/ui/toolbar";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CheckCircledIcon, FileTextIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getDiscussion } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { PiGitBranch } from "react-icons/pi";

const DiscussionPage: NextPageWithLayout = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const slug = router.query.slug as string;
  const id = router.query.discussionId as string;

  const [view, setView] = useState<"single" | "diff">("single");

  const {
    data: discussionData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...getDiscussion.useQuery({
      discussionId: id,
    }),
  });

  return (
    <GraphPageLayout
      title={id}
      subtitle=""
      breadcrumbs={[
        <Link key={0} href={`/${organizationSlug}/graph/${slug}/discussions`}>
          Discussions
        </Link>,
      ]}
      toolbar={
        <Toolbar className="hidden md:flex">
          <Tabs
            onValueChange={(view: any) => setView(view)}
            defaultValue="single"
            className="right-4 top-4 z-20"
          >
            <TabsList>
              <TabsTrigger value="single">
                <FileTextIcon className="mr-2" />
                Schema
              </TabsTrigger>
              <TabsTrigger value="diff">
                <PiGitBranch className="mr-2" />
                Compare Latest
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {discussionData?.discussion?.isResolved && (
            <Badge variant="outline" className="ml-auto gap-2 py-1.5">
              <CheckCircledIcon className="h-4 w-4 text-success" />{" "}
              <span>Resolved</span>
            </Badge>
          )}
        </Toolbar>
      }
      noPadding
    >
      <div className="flex h-[75vh] w-full flex-shrink-0 lg:h-full">
        <div className="relative hidden h-full w-max flex-1 flex-shrink md:flex">
          {isLoading && <Loader fullscreen />}
          {!isLoading &&
            (error || discussionData?.response?.code !== EnumStatusCode.OK) && (
              <EmptyState
                icon={<ExclamationTriangleIcon />}
                title="Could not retrieve reference schema"
                description={
                  discussionData?.response?.details ||
                  error?.message ||
                  "Please try again"
                }
                actions={<Button onClick={() => refetch()}>Retry</Button>}
              />
            )}
          {discussionData && (
            <DiscussionSchemas
              view={view}
              discussion={discussionData?.discussion}
            />
          )}
        </div>
        <Separator orientation="vertical" className="hidden md:block" />
        <div className="h-full w-full flex-shrink-0 md:max-w-sm lg:max-w-md">
          <Thread
            onDelete={() =>
              router.replace(`/${organizationSlug}/graph/${slug}/discussions`)
            }
          />
        </div>
      </div>
    </GraphPageLayout>
  );
};

DiscussionPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Discussions",
  });

export default DiscussionPage;
