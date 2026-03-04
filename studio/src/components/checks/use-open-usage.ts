import { useToast } from "../ui/use-toast";
import { useRouter } from "next/router";
import { formatISO, subHours } from "date-fns";

export const useOpenUsage = ({
  trafficCheckDays,
  createdAt,
}: {
  trafficCheckDays?: number;
  createdAt?: string;
}) => {
  const router = useRouter();
  const { toast } = useToast();

  const openUsage = (changeType: string, path?: string) => {
    if (!path) {
      toast({
        description: "Not enough data to fetch usage for this change",
        duration: 2000,
      });
      return;
    }

    const query: Record<string, any> = {
      showUsage: path,
    };

    if (
      [
        "UNION_MEMBER_REMOVED",
        "ENUM_VALUE_ADDED",
        "ENUM_VALUE_REMOVED",
      ].includes(changeType)
    ) {
      query.isNamedType = true;
      query.showUsage = path.split(".")[0];
    }

    if (trafficCheckDays && createdAt) {
      query.dateRange = JSON.stringify({
        start: formatISO(subHours(new Date(createdAt), 24 * trafficCheckDays)),
        end: formatISO(new Date(createdAt)),
      });
    }

    router.replace({
      pathname: router.pathname,
      query: {
        ...router.query,
        ...query,
      },
    });
  };

  return openUsage;
};
