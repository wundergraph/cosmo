import { useApplyParams } from "@/components/analytics/use-apply-params";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { SubgraphsTable } from "@/components/subgraphs-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NextPageWithLayout } from "@/lib/page";
import { Cross1Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import Fuse from "fuse.js";
import { FeatureFlagsTable } from "@/components/feature-flags-table";

const FeatureFlagsPage: NextPageWithLayout = () => {
  const graphData = useContext(GraphContext);
  const router = useRouter();

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const pageSize = Number.parseInt((router.query.pageSize as string) || "10");
  const limit = pageSize > 50 ? 50 : pageSize;
  const offset = (pageNumber - 1) * limit;
  const [search, setSearch] = useState(router.query.search as string);
  const applyParams = useApplyParams();

  if (!graphData) return null;

  const fuse = new Fuse(graphData.featureFlags, {
    keys: ["name"],
    minMatchCharLength: 1,
  });

  const searchedFeatureFlags = search
    ? fuse.search(search).map(({ item }) => item)
    : graphData.featureFlags;

  const filteredFeatureFlags = searchedFeatureFlags.slice(offset, limit + offset);

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
        <Input
          placeholder="Search by name"
          className="pl-8 pr-10"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            applyParams({ search: e.target.value });
          }}
        />
        {search && (
          <Button
            variant="ghost"
            className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
            onClick={() => {
              setSearch("");
              applyParams({ search: null });
            }}
          >
            <Cross1Icon />
          </Button>
        )}
      </div>
      <FeatureFlagsTable
        featureFlags={filteredFeatureFlags}
        graph={graphData.graph}
        totalCount={filteredFeatureFlags.length}
      />
    </div>
  );
};

FeatureFlagsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Feature Flags"
      subtitle="An overview of all feature flags"
    >
      {page}
    </GraphPageLayout>,
    { title: "Feature Flags" },
  );

export default FeatureFlagsPage;
