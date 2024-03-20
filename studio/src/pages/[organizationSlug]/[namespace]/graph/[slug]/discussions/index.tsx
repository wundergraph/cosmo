import { useApplyParams } from "@/components/analytics/use-apply-params";
import { GraphDiscussions } from "@/components/discussions/discussions";
import { DiscussionsToolbar } from "@/components/discussions/toolbar";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toolbar } from "@/components/ui/toolbar";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { Component2Icon } from "@radix-ui/react-icons";
import { Separator } from "@radix-ui/react-separator";
import { useRouter } from "next/router";
import { useContext, useMemo } from "react";
import { PiGraphLight } from "react-icons/pi";

const DiscussionsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const graphName = router.query.slug as string;
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;
  const subgraphId = router.query.subgraph as string;

  const graphData = useContext(GraphContext);

  const applyParams = useApplyParams();

  const selectedGraph = useMemo(
    () =>
      graphData?.subgraphs.find((s) => s.id === subgraphId) || graphData?.graph,
    [graphData?.graph, graphData?.subgraphs, subgraphId],
  );

  return (
    <PageHeader title="Discussions | Studio">
      <GraphPageLayout
        title="Discussions"
        subtitle="View discussions across schema versions of your graph"
        toolbar={
          <Toolbar>
            <DiscussionsToolbar />
            <Select
              onValueChange={(id) => {
                applyParams({
                  subgraph:
                    graphData?.subgraphs.find((s) => s.id === id)?.id || null,
                });
              }}
            >
              <SelectTrigger
                value={selectedGraph?.id ?? ""}
                className="w-full md:w-[200px]"
              >
                <SelectValue aria-label={selectedGraph?.id ?? ""}>
                  {graphData?.graph?.supportsFederation
                    ? selectedGraph?.name ?? ""
                    : selectedGraph?.id === graphData?.graph?.id
                    ? "Router SDL"
                    : "Published SDL"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {graphData?.graph?.supportsFederation ? (
                  <>
                    <SelectGroup>
                      <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                        <PiGraphLight className="h-3 w-3" /> Graph
                      </SelectLabel>
                      <SelectItem value={graphData?.graph?.id ?? ""}>
                        {graphName}
                      </SelectItem>
                    </SelectGroup>
                    <Separator className="my-2" />
                    <SelectGroup>
                      <SelectLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                        <Component2Icon className="h-3 w-3" /> Subgraphs
                      </SelectLabel>
                      {graphData?.subgraphs?.map(({ name, id }) => {
                        return (
                          <SelectItem key={id} value={id}>
                            {name}
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </>
                ) : (
                  <>
                    <SelectItem value={graphData?.graph?.id ?? ""}>
                      Router SDL
                    </SelectItem>
                    {graphData?.subgraphs?.map(({ id }) => {
                      return (
                        <SelectItem key={id} value={id}>
                          Published SDL
                        </SelectItem>
                      );
                    })}
                  </>
                )}
              </SelectContent>
            </Select>
          </Toolbar>
        }
      >
        <GraphDiscussions
          targetId={selectedGraph?.targetId}
          linkToSchema={`/${organizationSlug}/${namespace}/graph/${graphName}/schema`}
        />
      </GraphPageLayout>
    </PageHeader>
  );
};

DiscussionsPage.getLayout = getGraphLayout;

export default DiscussionsPage;
