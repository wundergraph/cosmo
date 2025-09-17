import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlobeIcon, ReaderIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import { Toolbar } from "../ui/toolbar";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

export const SchemaToolbar = ({
  tab,
  children,
}: {
  tab: "explorer" | "sdl";
  children?: React.ReactNode;
}) => {
  const router = useRouter();
  const { namespace: { name: namespace } } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  const query = {
    organizationSlug,
    namespace,
    slug: router.query.slug,
  };

  return (
    <Toolbar>
      <Tabs value={tab} className="w-full md:w-auto">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="explorer" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/[namespace]/graph/[slug]/schema",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <GlobeIcon />
              Explorer
            </Link>
          </TabsTrigger>
          <TabsTrigger value="sdl" asChild>
            <Link
              href={{
                pathname:
                  "/[organizationSlug]/[namespace]/graph/[slug]/schema/sdl",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <ReaderIcon />
              SDL
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {children}
    </Toolbar>
  );
};
