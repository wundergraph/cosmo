import { BookOpenIcon } from "@heroicons/react/24/outline";
import {
  CheckCircledIcon,
  Cross1Icon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import { useApplyParams } from "../analytics/use-apply-params";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useState } from "react";
import { useRouter } from "next/router";

export const DiscussionsToolbar = () => {
  const applyParams = useApplyParams();
  const router = useRouter();
  const [search, setSearch] = useState(router.query.search as string);

  return (
    <>
      <Tabs
        defaultValue="open"
        className="w-full md:w-max"
        onValueChange={(v) =>
          applyParams({
            resolved: v === "resolved" ? "true" : null,
          })
        }
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="open">
            <div className="flex items-center gap-x-2">
              <BookOpenIcon className="h-4 w-4" />
              Open
            </div>
          </TabsTrigger>
          <TabsTrigger value="resolved">
            <div className="flex items-center gap-x-2">
              <CheckCircledIcon className="h-4 w-4" />
              Resolved
            </div>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="relative ml-auto w-full md:w-auto">
        <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
        <Input
          placeholder="Filter by schema version"
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
              applyParams({
                search: null,
              });
            }}
          >
            <Cross1Icon />
          </Button>
        )}
      </div>
    </>
  );
};
