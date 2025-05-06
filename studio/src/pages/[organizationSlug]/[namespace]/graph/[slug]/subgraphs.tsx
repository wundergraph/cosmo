import { useApplyParams } from "@/components/analytics/use-apply-params";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { SubgraphPageTabs, SubgraphsTable } from "@/components/subgraphs-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NextPageWithLayout } from "@/lib/page";
import { Cross1Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useRouter } from "next/router";
import { useContext, useEffect, useState } from "react";
import Fuse from "fuse.js";
import { Subgraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { set } from "lodash";
import { Toolbar } from "@/components/ui/toolbar";

const SubGraphsPage: NextPageWithLayout = () => {
  const graphData = useContext(GraphContext);
  const router = useRouter();
  const tab = router.query.tab as string;

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const pageSize = Number.parseInt((router.query.pageSize as string) || "10");
  const limit = pageSize > 50 ? 50 : pageSize;
  const offset = (pageNumber - 1) * limit;
  const [search, setSearch] = useState(router.query.search as string);
  const applyParams = useApplyParams();

  const [filteredSubgraphs, setFilteredSubgraphs] = useState<Subgraph[]>([]);
  const [filteredFeatureSubgraphs, setFilteredFeatureSubgraphs] = useState<
    Subgraph[]
  >([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (!graphData) return;
    if (tab === "featureSubgraphs") {
      const fuse = new Fuse(graphData.featureSubgraphs, {
        keys: ["name"],
        useExtendedSearch: true,
      });

      const searchedFetaureSubgraphs = search
        ? fuse.search(`'${search}`).map(({ item }) => item)
        : graphData.featureSubgraphs;

      setTotalCount(searchedFetaureSubgraphs.length);
      setFilteredFeatureSubgraphs(
        searchedFetaureSubgraphs.slice(offset, limit + offset),
      );
    } else {
      const fuse = new Fuse(graphData.subgraphs, {
        keys: ["name", "id"],
        useExtendedSearch: true,
      });

      // https://www.fusejs.io/examples.html#default-weight:~:text=%23-,Extended%20Search,-This%20form%20of
      const searchedSubgraphs = search
        ? fuse.search(`'${search}`).map(({ item }) => item)
        : graphData.subgraphs;

      setTotalCount(searchedSubgraphs.length);
      setFilteredSubgraphs(searchedSubgraphs.slice(offset, limit + offset));
    }
  }, [tab, search, offset, limit, graphData]);

  if (!graphData) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
        <Input
          placeholder="Search by ID or Name"
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
      <SubgraphsTable
        key={tab}
        subgraphs={
          tab === "featureSubgraphs"
            ? filteredFeatureSubgraphs
            : filteredSubgraphs
        }
        graph={graphData.graph}
        totalCount={totalCount}
        tab={tab === "featureSubgraphs" ? "featureSubgraphs" : "subgraphs"}
      />
    </div>
  );
};

SubGraphsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Subgraphs"
      subtitle="View the subgraphs that compose this federated graph"
      toolbar={
        <Toolbar>
          <SubgraphPageTabs />
        </Toolbar>
      }
    >
      {page}
    </GraphPageLayout>,
    { title: "Subgraphs" },
  );

export default SubGraphsPage;
