import { formatDateTime } from "@/lib/format-date";
import { MinusIcon, PlusIcon } from "@radix-ui/react-icons";
import { FederatedGraphChangelogOutput } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import Link from "next/link";
import { useRouter } from "next/router";
import { PiCubeFocus } from "react-icons/pi";
import { Changes, getDiffCount } from "./changes";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

export const Changelog = ({
  entries,
}: {
  entries: FederatedGraphChangelogOutput[];
}) => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const { namespace: { name: namespace } } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  return (
    <ol className="relative w-full">
      {entries.map(
        ({ schemaVersionId: id, createdAt, changelogs, compositionId }) => {
          return (
            <li
              id={id}
              key={id}
              className="flex w-full flex-col gap-y-8 py-10 first:pt-2"
            >
              <div className="absolute left-40 mt-2 hidden h-3 w-3 rounded-full border bg-accent lg:block"></div>
              <div className="flex w-full flex-col items-start gap-x-16 gap-y-4 lg:flex-row">
                <div className="flex flex-col items-end gap-y-1">
                  <time className="mt-2 text-sm font-bold leading-none">
                    {formatDateTime(new Date(createdAt))}
                  </time>
                  <Link
                    href={`/${organizationSlug}/${namespace}/graph/${slug}/compositions/${compositionId}`}
                    className="flex items-center gap-x-1 text-sm text-primary hover:underline"
                  >
                    <PiCubeFocus className="h-4 w-4" />
                    Composition
                  </Link>
                  <p className="text-sm font-bold text-muted-foreground">
                    {id.slice(0, 6)}
                  </p>
                  <div>
                    <div className="flex items-center gap-x-1">
                      <PlusIcon className="text-success" />
                      <p className="text-sm text-success">
                        {getDiffCount(changelogs).addCount}
                      </p>
                    </div>
                    <div className="flex items-center gap-x-1">
                      <MinusIcon className="text-destructive" />
                      <p className="text-sm text-destructive">
                        {getDiffCount(changelogs).minusCount}
                      </p>
                    </div>
                  </div>
                </div>
                <hr className="w-full lg:hidden" />

                <Changes changes={changelogs} />
              </div>
            </li>
          );
        },
      )}
    </ol>
  );
};
