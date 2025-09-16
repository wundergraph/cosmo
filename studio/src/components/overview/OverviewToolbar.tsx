import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toolbar } from "@/components/ui/toolbar";
import { HomeIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { TbBook } from "react-icons/tb";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

export const OverviewToolbar = ({
  tab,
  children,
}: {
  tab: "overview" | "readme";
  children?: React.ReactNode;
}) => {
  const router = useRouter();
  const { namespace: { name: namespace } } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  const query = {
    namespace,
    organizationSlug,
    slug: router.query.slug,
  };

  return (
    <Toolbar>
      <Tabs value={tab} className="w-full md:w-auto">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/[namespace]/graph/[slug]",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <HomeIcon />
              Overview
            </Link>
          </TabsTrigger>
          <TabsTrigger value="readme" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/[namespace]/graph/[slug]/readme",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <TbBook />
              README
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {children}
    </Toolbar>
  );
};
