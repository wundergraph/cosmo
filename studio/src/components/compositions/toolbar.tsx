import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeftIcon, TokensIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback } from "react";
import { PiBracketsCurlyBold } from "react-icons/pi";
import { Button } from "../ui/button";

export const CompositionToolbar = ({
  tab,
}: {
  tab: "overview" | "inputSchemas" | "outputSchema";
}) => {
  const router = useRouter();

  const query = {
    organizationSlug: router.query.organizationSlug,
    slug: router.query.slug,
    comspositionId: router.query.comspositionId,
  };

  const handleViewAll = useCallback(() => {
    const parts = router.asPath.split("/");
    router.push(parts.slice(0, parts.length - 1).join("/"));
  }, [router]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
      <Button
        onClick={() => handleViewAll()}
        variant="link"
        size="sm"
        className="p-0"
      >
        <ChevronLeftIcon />
        View all compositions
      </Button>
      <Tabs value={tab} className="w-full md:w-auto">
        <TabsList className="grid w-full grid-cols-3 md:block">
          <TabsTrigger value="overview" asChild>
            <Link
              href={{
                pathname:
                  "/[organizationSlug]/graph/[slug]/checks/[compositionId]",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <TokensIcon />
              Overview
            </Link>
          </TabsTrigger>
          <TabsTrigger value="operations" asChild>
            <Link
              href={{
                pathname:
                  "/[organizationSlug]/graph/[slug]/checks/[compositionId]/inputs",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <PiBracketsCurlyBold className="flex-shrink-0" />
              Input Schemas
            </Link>
          </TabsTrigger>
          <TabsTrigger value="operations" asChild>
            <Link
              href={{
                pathname:
                  "/[organizationSlug]/graph/[slug]/checks/[compositionId]/output",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <PiBracketsCurlyBold className="flex-shrink-0" />
              Output Schema
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
};
