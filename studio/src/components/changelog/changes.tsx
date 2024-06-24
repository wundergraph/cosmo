import { cn } from "@/lib/utils";
import {
  MinusIcon,
  PlusIcon,
  UpdateIcon,
  DotFilledIcon,
} from "@radix-ui/react-icons";
import { FederatedGraphChangelog } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { noCase } from "change-case";
import { Badge } from "../ui/badge";

interface StructuredChangelog {
  changeType: string;
  parentName: string;
  childName: string;
}

const structureChangelogs = (
  changes: FederatedGraphChangelog[],
): StructuredChangelog[] => {
  let parentNodeName = "";
  const structuredChangelogs: StructuredChangelog[] = [];

  for (const change of changes) {
    const splitPath = change.path.split(".");
    if (splitPath.length === 1) {
      structuredChangelogs.push({
        changeType: change.changeType,
        parentName: splitPath[0],
        childName: "",
      });
    } else if (splitPath[0] === parentNodeName) {
      structuredChangelogs.push({
        changeType: change.changeType,
        parentName: splitPath[0],
        childName: splitPath[1],
      });
    } else {
      structuredChangelogs.push({
        changeType: "",
        parentName: splitPath[0],
        childName: "",
      });
      structuredChangelogs.push({
        changeType: change.changeType,
        parentName: splitPath[0],
        childName: splitPath[1],
      });
    }
    parentNodeName = splitPath[0];
  }
  return structuredChangelogs;
};

const getDiffCount = (changelogs: FederatedGraphChangelog[]) => {
  let addCount = 0;
  let minusCount = 0;
  changelogs.forEach((log) => {
    if (log.changeType.includes("REMOVED")) {
      minusCount += 1;
    } else if (log.changeType.includes("ADDED")) {
      addCount += 1;
    } else if (log.changeType.includes("CHANGED")) {
      addCount += 1;
      minusCount += 1;
    }
  });
  return {
    addCount,
    minusCount,
  };
};

const Changes = ({ changes }: { changes: FederatedGraphChangelog[] }) => {
  let parentNodeName = "";
  let shouldHavePadding = false;

  const getIcon = (code: string) => {
    if (code.includes("REMOVED")) {
      return <MinusIcon className="text-destructive" width={25} />;
    }
    if (code.includes("ADDED")) {
      return <PlusIcon className="text-success" width={25} />;
    }
    if (code.includes("CHANGED")) {
      return <UpdateIcon className="text-muted-foreground" width={25} />;
    }
    return (
      <DotFilledIcon className="text-muted-foreground" width={25} height={25} />
    );
  };

  const structuredChangelogs = structureChangelogs(changes);

  return (
    <div className="flex flex-col gap-y-2 pt-4 lg:pt-0">
      {structuredChangelogs.map(
        ({ changeType, parentName, childName }, index) => {
          if (parentName !== parentNodeName) {
            parentNodeName = parentName;
            shouldHavePadding = false;
          } else {
            shouldHavePadding = true;
          }

          return (
            <div
              className={cn("flex items-center gap-x-2", {
                "ml-4": shouldHavePadding,
              })}
              key={index}
            >
              {getIcon(changeType)}
              <Badge variant="secondary" className="text-sm">
                {childName || parentName}
              </Badge>
              <span className="hidden text-xs italic text-muted-foreground md:block">
                {noCase(changeType)}
              </span>
            </div>
          );
        },
      )}
    </div>
  );
};

export { Changes, getDiffCount };
