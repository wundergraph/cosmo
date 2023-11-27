import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReaderIcon, TokensIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { PiBracketsCurlyBold } from "react-icons/pi";
import { Toolbar } from "../ui/toolbar";

export const ChecksToolbar = ({
  tab,
}: {
  tab: "overview" | "operations" | "details";
}) => {
  const router = useRouter();

  const query = {
    organizationSlug: router.query.organizationSlug,
    slug: router.query.slug,
    checkId: router.query.checkId,
  };

  return (
    <Toolbar>
      <Tabs value={tab} className="w-full md:w-auto">
        <TabsList className="grid w-full grid-cols-3 md:block">
          <TabsTrigger value="overview" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/graph/[slug]/checks/[checkId]",
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
                  "/[organizationSlug]/graph/[slug]/checks/[checkId]/operations",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <PiBracketsCurlyBold className="flex-shrink-0" />
              Operations
            </Link>
          </TabsTrigger>
          <TabsTrigger value="details" asChild>
            <Link
              href={{
                pathname:
                  "/[organizationSlug]/graph/[slug]/checks/[checkId]/details",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <ReaderIcon />
              Details
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </Toolbar>
  );
};
